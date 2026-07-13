# 아키텍처

## 프로세스 경계

```text
Renderer (React UI)
  ├─ getDisplayMedia / getUserMedia
  ├─ Web Audio mixer
  └─ MediaRecorder (Chromium media threads / hardware acceleration)
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

Chromium은 캡처와 인코딩을 전용 미디어 스레드에서 실행한다. 파일 I/O는 Electron 메인 프로세스의 비동기 파일 API로 분리한다. Renderer는 1초 단위 청크만 보유하며, 대기 데이터가 32MB를 넘으면 `MediaRecorder`를 잠시 멈추고 8MB 아래에서 재개해 메모리 증가를 제한한다.

## 보안 경계

- Renderer의 Node 통합은 비활성화한다.
- Context isolation과 sandbox를 활성화한다.
- 파일 경로와 데스크톱 소스 접근은 preload의 좁은 API를 통해서만 허용한다.
- 원격 콘텐츠를 로드하지 않으며 CSP로 실행 가능한 소스를 제한한다.

## 장애 복구

기록 중 앱이 비정상 종료되면 이미 디스크에 기록된 컨테이너 청크가 남는다. 정상 종료 시에는 모든 대기 청크를 기록한 후 파일 핸들을 닫는다. 앱 종료 요청 중 녹화가 진행 중이면 사용자에게 확인한다.

