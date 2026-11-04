// suflyor-audio: captures system audio via ScreenCaptureKit and writes PCM s16le, 16 kHz, mono to stdout.
// Status lines are JSON on stderr: {"event":"started"} / {"event":"error","code":"...","message":"..."}.
// Exits on SIGTERM, SIGINT or stdin EOF (so it never outlives the parent app).
import Foundation
import ScreenCaptureKit
import CoreMedia

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

let output = AudioOutput()
var activeStream: SCStream?

func shutdown(_ code: Int32) -> Never {
    if let s = activeStream {
        let sem = DispatchSemaphore(value: 0)
        s.stopCapture { _ in sem.signal() }
        _ = sem.wait(timeout: .now() + 1)
    }
    exit(code)
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

Task { await start() }
dispatchMain()
