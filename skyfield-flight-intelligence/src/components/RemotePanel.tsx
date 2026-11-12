import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface RemotePanelProps {
  /** Null while the session is being set up. */
  url: string | null;
  online: boolean;
  onClose: () => void;
  onDisconnect: () => void;
}

/** QR code that pairs a phone as the remote. Closes itself on the first tap from the phone. */
export function RemotePanel({ url, online, onClose, onDisconnect }: RemotePanelProps) {
  const qrSrc = useMemo(() => {
    if (!url) return null;
    const qr = qrcode(0, "L");
    qr.addData(url);
    qr.make();
    return qr.createDataURL(6, 12);
  }, [url]);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card remote-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <span>Phone remote</span>
          <button className="help-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {qrSrc ? (
          <img
            className="remote-qr"
            src={qrSrc}
            alt="QR code that opens the Skyfield remote on a phone"
            data-remote-url={url ?? undefined} // the same address as the QR, for testing without a camera
          />
        ) : (
          <div className="remote-qr remote-qr--wait">{online ? "" : "Preparing the remote…"}</div>
        )}
        <p className="remote-hint">
          Scan with your phone camera, then tap a button. This panel closes on the first tap. The code works for 6 hours.
        </p>
        <p className={`remote-status${online ? " remote-status--on" : ""}`} role="status">
          {online ? "● Ready for a phone" : "○ Connecting…"}
        </p>
        <button className="band" onClick={onDisconnect}>
          Disconnect remote
        </button>
      </div>
    </div>
  );
}
