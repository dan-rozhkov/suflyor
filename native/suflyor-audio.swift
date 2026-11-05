// suflyor-audio: captures system audio via ScreenCaptureKit and writes PCM s16le, 16 kHz, mono to stdout.
// With --mic it captures the default input device (AVAudioEngine) instead, in the same output format.
// Status lines are JSON on stderr: {"event":"started"} / {"event":"error","code":"...","message":"..."}.
// Exits on SIGTERM, SIGINT or stdin EOF (so it never outlives the parent app).
import Foundation
import ScreenCaptureKit
import CoreMedia
import AVFoundation

func emit(_ event: String, code: String? = nil, message: String? = nil) {
    var obj: [String: String] = ["event": event]
    if let code = code { obj["code"] = code }
    if let message = message { obj["message"] = message }
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) {
        var line = data
        line.append(0x0A)
        FileHandle.standardError.write(line)
    }
}

func writeAll(_ data: Data) {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        var offset = 0
        while offset < raw.count {
            let n = write(STDOUT_FILENO, raw.baseAddress! + offset, raw.count - offset)
            if n < 0 {
                if errno == EINTR { continue }
                exit(0) // stdout closed: parent is gone
            }
            offset += n
        }
    }
}

final class AudioOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, CMSampleBufferGetNumSamples(sampleBuffer) > 0 else { return }
        var out = Data()
        do {
            try sampleBuffer.withAudioBufferList { list, _ in
                // Mono float32: a single buffer. If several channels come back, use the first one.
                guard let first = list.unsafePointer.pointee.mBuffers.mData else { return }
                let bytes = Int(list.unsafePointer.pointee.mBuffers.mDataByteSize)
                let count = bytes / MemoryLayout<Float>.size
                let src = first.assumingMemoryBound(to: Float.self)
                var pcm = [Int16](repeating: 0, count: count)
                for i in 0..<count {
                    let s = max(-1, min(1, src[i]))
                    pcm[i] = s < 0 ? Int16((s * 32768).rounded()) : Int16((s * 32767).rounded())
                }
                out = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
            }
        } catch {
            return
        }
        if !out.isEmpty { writeAll(out) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit("error", code: "stream-stopped", message: error.localizedDescription)
        exit(2)
    }
}

let micMode = CommandLine.arguments.contains("--mic")
let output = AudioOutput()
var activeStream: SCStream?

/// Default input -> PCM s16le 16 kHz mono on stdout. Follows input device changes.
final class MicCapture {
    private let engine = AVAudioEngine()
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    private var converter: AVAudioConverter?
    private var observer: NSObjectProtocol?
    private var failed = false

    func begin() throws {
        let input = engine.inputNode
        let inFmt = input.outputFormat(forBus: 0)
        guard inFmt.sampleRate > 0, inFmt.channelCount > 0 else {
            throw NSError(domain: "suflyor", code: 1, userInfo: [NSLocalizedDescriptionKey: "No input device"])
        }
        guard let conv = AVAudioConverter(from: inFmt, to: target) else {
            throw NSError(domain: "suflyor", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot convert input format"])
        }
        converter = conv
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { [weak self] buffer, _ in
            self?.handle(buffer)
        }
        engine.prepare()
        try engine.start()
    }

    func start() {
        // Observe before the engine starts, so a device change during startup is not missed.
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            self?.restart()
        }
        do {
            try begin()
        } catch {
            emit("error", code: "capture-failed", message: error.localizedDescription)
            exit(3)
        }
        emit("started")
    }

    /// The input device or its format changed: the engine stopped itself. Rebuild the tap, or report and exit.
    private func restart() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        do {
            try begin()
        } catch {
            emit("error", code: "device-changed", message: error.localizedDescription)
            exit(3)
        }
    }

    private func handle(_ buffer: AVAudioPCMBuffer) {
        guard let conv = converter, buffer.frameLength > 0 else { return }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var fed = false
        var err: NSError?
        let status = conv.convert(to: out, error: &err) { _, inputStatus in
            if fed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if status == .error {
            if !failed {
                failed = true
                emit("error", code: "convert-failed", message: err?.localizedDescription ?? "Audio conversion failed")
                shutdown(3)
            }
            return
        }
        if out.frameLength == 0 { return }
        guard let ch = out.int16ChannelData else { return }
        writeAll(Data(bytes: ch[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size))
    }

    func stop() {
        if let o = observer { NotificationCenter.default.removeObserver(o) }
        observer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

var activeMic: MicCapture?

func startMic() {
    func go() {
        let m = MicCapture()
        activeMic = m
        m.start()
    }
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        go()
    case .notDetermined:
        // The app asks first (Electron has the usage description). If nobody answers, do not hang silently.
        var answered = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
            if !answered {
                emit("error", code: "no-mic-permission", message: "No answer to the microphone permission request")
                exit(3)
            }
        }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                answered = true
                if granted {
                    go()
                } else {
                    emit("error", code: "no-mic-permission", message: "Microphone access was denied")
                    exit(3)
                }
            }
        }
    default:
        emit("error", code: "no-mic-permission", message: "Microphone access is not allowed")
        exit(3)
    }
}

var shuttingDown = false

/// Safe from any thread (signals, stdin EOF, audio errors can race): teardown runs once, on the main queue only.
func shutdown(_ code: Int32) {
    DispatchQueue.main.async {
        if shuttingDown { return }
        shuttingDown = true
        activeMic?.stop()
        if let s = activeStream {
            let sem = DispatchSemaphore(value: 0)
            s.stopCapture { _ in sem.signal() }
            _ = sem.wait(timeout: .now() + 1)
        }
        exit(code)
    }
}

// Signals and stdin EOF.
signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
signal(SIGPIPE, SIG_IGN)
let termSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSrc.setEventHandler { shutdown(0) }
termSrc.resume()
let intSrc = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
intSrc.setEventHandler { shutdown(0) }
intSrc.resume()
Thread.detachNewThread {
    var buf = [UInt8](repeating: 0, count: 256)
    while true {
        let n = read(STDIN_FILENO, &buf, buf.count)
        if n == 0 || (n < 0 && errno != EINTR) { break }
    }
    shutdown(0)
}

func start() async {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            emit("error", code: "no-display", message: "No display available")
            exit(3)
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.sampleRate = 16000
        cfg.channelCount = 1
        cfg.excludesCurrentProcessAudio = true
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        cfg.queueDepth = 3
        cfg.showsCursor = false
        let stream = SCStream(filter: filter, configuration: cfg, delegate: output)
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: DispatchQueue(label: "suflyor.audio"))
        activeStream = stream
        try await stream.startCapture()
        emit("started")
    } catch {
        let ns = error as NSError
        // SCStreamErrorUserDeclined = -3801
        if ns.domain == SCStreamErrorDomain && ns.code == -3801 {
            emit("error", code: "no-screen-permission", message: ns.localizedDescription)
        } else {
            emit("error", code: "capture-failed", message: "\(ns.domain) \(ns.code): \(ns.localizedDescription)")
        }
        exit(3)
    }
}

if micMode {
    startMic()
} else {
    Task { await start() }
}
dispatchMain()
