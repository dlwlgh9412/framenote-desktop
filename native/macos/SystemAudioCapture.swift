import AVFoundation
import AppKit
import CoreAudio
import CoreMedia
import Darwin
import Dispatch
import Foundation
import ScreenCaptureKit

private enum SourceType: String {
    case screen
    case window
}

private struct CaptureTarget {
    let type: SourceType
    let id: UInt32

    static func parse(arguments: [String]) throws -> CaptureTarget {
        guard
            let typeIndex = arguments.firstIndex(of: "--type"),
            arguments.indices.contains(typeIndex + 1),
            let type = SourceType(rawValue: arguments[typeIndex + 1]),
            let idIndex = arguments.firstIndex(of: "--id"),
            arguments.indices.contains(idIndex + 1),
            let id = UInt32(arguments[idIndex + 1]),
            id > 0
        else {
            throw NSError(
                domain: "MinuteFrameAudio",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Usage: --type screen|window --id <native-id>"]
            )
        }
        return CaptureTarget(type: type, id: id)
    }
}

private func writeStatus(_ value: String) {
    FileHandle.standardError.write(Data("\(value)\n".utf8))
}

private func checked(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw NSError(
            domain: NSOSStatusErrorDomain,
            code: Int(status),
            userInfo: [NSLocalizedDescriptionKey: "\(operation) failed (Core Audio status \(status))."]
        )
    }
}

private final class FramedPCMOutput {
    private let output = FileHandle.standardOutput
    private let queue = DispatchQueue(label: "com.minuteframe.pcm-output", qos: .userInitiated)
    private let stateLock = NSLock()
    private let maxPendingBytes = 16 * 1024 * 1024
    private var pendingBytes = 0

    func write(_ samples: [Float]) {
        guard !samples.isEmpty else { return }
        var byteLength = UInt32(samples.count * MemoryLayout<Float>.size).littleEndian
        let header = Data(bytes: &byteLength, count: MemoryLayout<UInt32>.size)
        let payload = samples.withUnsafeBytes { Data($0) }
        let packetBytes = header.count + payload.count

        stateLock.lock()
        guard pendingBytes + packetBytes <= maxPendingBytes else {
            stateLock.unlock()
            return
        }
        pendingBytes += packetBytes
        stateLock.unlock()

        queue.async { [self] in
            autoreleasepool {
                output.write(header)
                output.write(payload)
            }
            stateLock.lock()
            pendingBytes -= packetBytes
            stateLock.unlock()
        }
    }
}

private final class AudioOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    private let output: FramedPCMOutput

    init(output: FramedPCMOutput) {
        self.output = output
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else {
            return
        }
        do {
            let samples = try interleavedStereoSamples(from: sampleBuffer)
            output.write(samples)
        } catch {
            writeStatus("ERROR:\(error.localizedDescription)")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        writeStatus("ERROR:\(error.localizedDescription)")
        exit(2)
    }

    private func interleavedStereoSamples(from sampleBuffer: CMSampleBuffer) throws -> [Float] {
        guard
            let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
            let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
        else {
            throw NSError(
                domain: "MinuteFrameAudio",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Audio format metadata is missing."]
            )
        }

        let format = streamDescription.pointee
        guard format.mFormatID == kAudioFormatLinearPCM else {
            throw NSError(
                domain: "MinuteFrameAudio",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "ScreenCaptureKit returned non-PCM audio."]
            )
        }

        let channelCount = max(1, Int(format.mChannelsPerFrame))
        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        let audioBufferList = AudioBufferList.allocate(maximumBuffers: channelCount)
        defer { free(audioBufferList.unsafeMutablePointer) }
        var retainedBlockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferList.unsafeMutablePointer,
            bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: channelCount),
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &retainedBlockBuffer
        )
        guard status == noErr else {
            throw NSError(
                domain: NSOSStatusErrorDomain,
                code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "Unable to read the captured PCM buffer."]
            )
        }

        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList.unsafeMutablePointer)
        let isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isSignedInteger = (format.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
        let isNonInterleaved = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        var result = [Float](repeating: 0, count: frameCount * 2)

        func sample(buffer: AudioBuffer, index: Int) -> Float {
            guard let data = buffer.mData else { return 0 }
            if isFloat && format.mBitsPerChannel == 32 {
                return data.assumingMemoryBound(to: Float.self)[index]
            }
            if isSignedInteger && format.mBitsPerChannel == 16 {
                return Float(data.assumingMemoryBound(to: Int16.self)[index]) / 32768
            }
            return 0
        }

        if isNonInterleaved || buffers.count > 1 {
            for frame in 0..<frameCount {
                let left = sample(buffer: buffers[0], index: frame)
                let right = buffers.count > 1 ? sample(buffer: buffers[1], index: frame) : left
                result[frame * 2] = left
                result[frame * 2 + 1] = right
            }
        } else if let buffer = buffers.first {
            for frame in 0..<frameCount {
                let base = frame * channelCount
                let left = sample(buffer: buffer, index: base)
                let right = channelCount > 1 ? sample(buffer: buffer, index: base + 1) : left
                result[frame * 2] = left
                result[frame * 2 + 1] = right
            }
        }
        return result
    }
}

private func parentProcessID(of pid: pid_t) -> pid_t? {
    var info = proc_bsdinfo()
    let byteCount = withUnsafeMutablePointer(to: &info) { pointer in
        proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            pointer,
            Int32(MemoryLayout<proc_bsdinfo>.size)
        )
    }
    guard byteCount == MemoryLayout<proc_bsdinfo>.size else { return nil }
    return pid_t(info.pbi_ppid)
}

private func isProcess(_ pid: pid_t, descendedFrom rootPID: pid_t) -> Bool {
    var current = pid
    var visited = Set<pid_t>()
    while current > 1, visited.insert(current).inserted {
        if current == rootPID { return true }
        guard let parent = parentProcessID(of: current) else { return false }
        current = parent
    }
    return false
}

private func processObjectIDs(descendingFrom rootPID: pid_t) throws -> [AudioObjectID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var byteCount: UInt32 = 0
    try checked(
        AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &byteCount
        ),
        "Reading the Core Audio process list"
    )
    var objectIDs = [AudioObjectID](
        repeating: AudioObjectID(kAudioObjectUnknown),
        count: Int(byteCount) / MemoryLayout<AudioObjectID>.size
    )
    let listStatus = objectIDs.withUnsafeMutableBytes { bytes in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &byteCount,
            bytes.baseAddress!
        )
    }
    try checked(listStatus, "Reading Core Audio process identifiers")

    return objectIDs.filter { objectID in
        var processAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyPID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var pid: pid_t = 0
        var pidSize = UInt32(MemoryLayout<pid_t>.size)
        let status = AudioObjectGetPropertyData(
            objectID,
            &processAddress,
            0,
            nil,
            &pidSize,
            &pid
        )
        return status == noErr && isProcess(pid, descendedFrom: rootPID)
    }
}

@available(macOS 14.2, *)
private final class CoreAudioProcessTapCapture {
    private let output: FramedPCMOutput
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?

    init(output: FramedPCMOutput) {
        self.output = output
    }

    deinit {
        stop()
    }

    func start(processIDs: [AudioObjectID]) throws {
        guard !processIDs.isEmpty else {
            throw NSError(
                domain: "MinuteFrameAudio",
                code: 9,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "The selected application has no active Core Audio process yet. Play audio and try again."
                ]
            )
        }

        let description = CATapDescription(stereoMixdownOfProcesses: processIDs)
        description.name = "MinuteFrame selected application audio"
        description.isPrivate = true
        try checked(
            AudioHardwareCreateProcessTap(description, &tapID),
            "Creating the selected-application audio tap"
        )

        let format = try tapFormat()
        let tapUID = try tapUniqueIdentifier()
        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "MinuteFrame selected application audio",
            kAudioAggregateDeviceUIDKey: "com.minuteframe.capture.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID]]
        ]
        try checked(
            AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateDeviceID),
            "Creating the private aggregate audio device"
        )

        let callbackQueue = DispatchQueue(
            label: "com.minuteframe.process-audio",
            qos: .userInitiated
        )
        var callback: AudioDeviceIOProcID?
        let output = self.output
        try checked(
            AudioDeviceCreateIOProcIDWithBlock(
                &callback,
                aggregateDeviceID,
                callbackQueue
            ) { _, inputData, _, _, _ in
                output.write(Self.interleavedStereoSamples(from: inputData, format: format))
            },
            "Creating the process-audio callback"
        )
        ioProcID = callback
        try checked(
            AudioDeviceStart(aggregateDeviceID, callback),
            "Starting selected-application audio capture"
        )
    }

    private func tapUniqueIdentifier() throws -> CFString {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var byteCount = UInt32(MemoryLayout<CFString>.size)
        var value: CFString = "" as CFString
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(tapID, &address, 0, nil, &byteCount, pointer)
        }
        try checked(status, "Reading the process tap identifier")
        return value
    }

    private func tapFormat() throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var format = AudioStreamBasicDescription()
        var byteCount = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try checked(
            AudioObjectGetPropertyData(tapID, &address, 0, nil, &byteCount, &format),
            "Reading the process tap format"
        )
        guard format.mFormatID == kAudioFormatLinearPCM else {
            throw NSError(
                domain: "MinuteFrameAudio",
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: "The process tap returned non-PCM audio."]
            )
        }
        return format
    }

    private static func interleavedStereoSamples(
        from inputData: UnsafePointer<AudioBufferList>,
        format: AudioStreamBasicDescription
    ) -> [Float] {
        let buffers = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: inputData)
        )
        guard let first = buffers.first else { return [] }
        let isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isSignedInteger = (format.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
        let bytesPerSample = max(1, Int(format.mBitsPerChannel) / 8)
        let channelCount = max(1, Int(format.mChannelsPerFrame))
        let nonInterleaved = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
            || buffers.count > 1
        let frameCount = nonInterleaved
            ? Int(first.mDataByteSize) / bytesPerSample
            : Int(first.mDataByteSize) / (bytesPerSample * channelCount)
        guard frameCount > 0 else { return [] }

        func sample(_ buffer: AudioBuffer, _ index: Int) -> Float {
            guard let data = buffer.mData else { return 0 }
            if isFloat && format.mBitsPerChannel == 32 {
                return data.assumingMemoryBound(to: Float.self)[index]
            }
            if isSignedInteger && format.mBitsPerChannel == 16 {
                return Float(data.assumingMemoryBound(to: Int16.self)[index]) / 32768
            }
            return 0
        }

        var result = [Float](repeating: 0, count: frameCount * 2)
        for frame in 0..<frameCount {
            let left: Float
            let right: Float
            if nonInterleaved {
                left = sample(buffers[0], frame)
                right = buffers.count > 1 ? sample(buffers[1], frame) : left
            } else {
                let base = frame * channelCount
                left = sample(first, base)
                right = channelCount > 1 ? sample(first, base + 1) : left
            }
            result[frame * 2] = left
            result[frame * 2 + 1] = right
        }
        return result
    }

    private func stop() {
        if aggregateDeviceID != AudioObjectID(kAudioObjectUnknown) {
            _ = AudioDeviceStop(aggregateDeviceID, ioProcID)
            if let ioProcID {
                _ = AudioDeviceDestroyIOProcID(aggregateDeviceID, ioProcID)
            }
            _ = AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != AudioObjectID(kAudioObjectUnknown) {
            _ = AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }
}

@available(macOS 13.0, *)
private final class CaptureSession {
    private let framedOutput = FramedPCMOutput()
    private lazy var output = AudioOutput(output: framedOutput)
    private var stream: SCStream?
    private var processTap: AnyObject?

    func start(target: CaptureTarget) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )
        switch target.type {
        case .screen:
            guard let display = content.displays.first(where: { $0.displayID == target.id }) else {
                throw NSError(
                    domain: "MinuteFrameAudio",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "The selected display is no longer available."]
                )
            }
            let filter = SCContentFilter(
                display: display,
                excludingApplications: [],
                exceptingWindows: []
            )
            try await startDisplayCapture(filter: filter)
        case .window:
            guard let window = content.windows.first(where: { $0.windowID == target.id }) else {
                throw NSError(
                    domain: "MinuteFrameAudio",
                    code: 5,
                    userInfo: [NSLocalizedDescriptionKey: "The selected window is no longer available."]
                )
            }
            guard let application = window.owningApplication else {
                throw NSError(
                    domain: "MinuteFrameAudio",
                    code: 7,
                    userInfo: [NSLocalizedDescriptionKey: "The selected window has no owning application."]
                )
            }
            guard #available(macOS 14.2, *) else {
                throw NSError(
                    domain: "MinuteFrameAudio",
                    code: 11,
                    userInfo: [
                        NSLocalizedDescriptionKey:
                            "Selected-application audio capture requires macOS 14.2 or newer."
                    ]
                )
            }
            let processIDs = try processObjectIDs(descendingFrom: application.processID)
            let capture = CoreAudioProcessTapCapture(output: framedOutput)
            try capture.start(processIDs: processIDs)
            processTap = capture
            writeStatus("READY")
        }
    }

    private func startDisplayCapture(filter: SCContentFilter) async throws {
        let configuration = SCStreamConfiguration()
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 3
        configuration.capturesAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.excludesCurrentProcessAudio = true

        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        try stream.addStreamOutput(
            output,
            type: .audio,
            sampleHandlerQueue: DispatchQueue(label: "com.minuteframe.audio", qos: .userInitiated)
        )
        self.stream = stream
        try await stream.startCapture()
        writeStatus("READY")
    }
}

do {
    guard #available(macOS 13.0, *) else {
        throw NSError(
            domain: "MinuteFrameAudio",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "System audio capture requires macOS 13 or newer."]
        )
    }
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    let target = try CaptureTarget.parse(arguments: CommandLine.arguments)
    let capture = CaptureSession()
    Task {
        do {
            try await capture.start(target: target)
        } catch {
            writeStatus("ERROR:\(error.localizedDescription)")
            exit(1)
        }
    }
    dispatchMain()
} catch {
    writeStatus("ERROR:\(error.localizedDescription)")
    exit(1)
}
