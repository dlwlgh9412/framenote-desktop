# 아키텍처

## 프로세스 경계

```text
Renderer (React UI)
  ├─ getDisplayMedia / getUserMedia
  ├─ Web Audio mixer
  ├─ Video MediaRecorder (Chromium media threads / hardware acceleration)
  └─ Optional audio-only MediaRecorder (M4A/AAC → WebM/Opus fallback)
               │ 1-second chunks, bounded queue
               ▼
Preload (narrow, typed IPC bridge)
               │ invoke + backpressure
               ▼
Main process
  ├─ source and permission broker
  ├─ async file sink
  └─ preference store / native dialogs
```

Chromium은 캡처와 인코딩을 전용 미디어 스레드에서 실행한다. 파일 I/O는 Electron 메인 프로세스의 비동기 파일 API로 분리한다. Renderer는 1초 단위 청크만 보유한다. 대기 데이터가 32MB를 넘으면 회의 구간을 조용히 누락하거나 메모리를 무한히 늘리는 대신 녹화를 종료하고 현재까지의 데이터를 마무리한 뒤 사용자에게 알린다.

음성 파일 추출을 켜면 Web Audio mixer가 만든 동일한 혼합 오디오 트랙을 오디오 전용 MediaRecorder에도 연결한다. 영상과 음성은 독립된 파일 세션과 `.partial` 파일에 기록된다. 영상 저장은 필수 결과이고 음성 파일은 선택 결과이므로, 음성 인코더나 음성 파일 기록만 실패하면 해당 오디오 세션을 폐기하되 영상 녹화와 최종 파일은 유지한다.

화면·창 썸네일 생성은 비교적 비싼 네이티브 작업이므로 최초 로드, 화면 권한이 새로 허용된 시점, 사용자의 명시적 새로고침에서만 실행한다. 동시에 들어온 새로고침은 single-flight로 합쳐 중복 캡처와 대용량 base64 IPC를 막는다. 오디오 장치 목록은 `devicechange` 이벤트로 갱신한다.

## 보안 경계

- Renderer의 Node 통합은 비활성화한다.
- Context isolation과 sandbox를 활성화한다.
- 파일 경로와 데스크톱 소스 접근은 preload의 좁은 API를 통해서만 허용한다.
- 원격 콘텐츠를 로드하지 않으며 CSP로 실행 가능한 소스를 제한한다.

## 장애 복구

기록 중에는 최종 파일명 뒤에 `.partial`을 붙여 쓴다. 정상 종료 시 모든 대기 청크를 기록하고 `fsync`·close를 완료한 다음 최종 파일명으로 원자적으로 rename한다. 시작 실패나 제어된 중단에서는 `.partial`을 삭제하므로 손상된 파일이 정상 녹화처럼 보이지 않는다. 반면 최종 rename만 실패하면 이미 동기화된 회의를 삭제하지 않고 `.partial` 경로를 오류 메시지로 안내한다. 비정상 프로세스 종료 뒤에도 복구 가능한 청크가 `.partial`로 남을 수 있다. 앱 종료 요청 중 녹화가 진행 중이면 사용자에게 확인한다.

설정 파일은 TypeScript 타입 단언에 의존하지 않고 런타임에서 각 필드를 검증한다. 손상되거나 이전 버전에서 남은 알 수 없는 값은 필드별 기본값으로 복구하며, 설정 저장은 한 프로세스 안에서 직렬화한 뒤 임시 파일 rename으로 게시한다.
