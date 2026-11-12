import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface RemotePanelProps {
  url: string;
  online: boolean;
  onClose: () => void;
  onDisconnect: () => void;
}

/** QR code that pairs a phone as the remote. Closes itself on the first tap from the phone. */
export function RemotePanel({ url, online, onClose, onDisconnect }: RemotePanelProps) {
  const qrSrc = useMemo(() => {
    const qr = qrcode(0, "M");
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
        <img className="remote-qr" src={qrSrc} alt="QR code that opens the Skyfield remote on a phone" />
        <p className="remote-hint">
          Scan with your phone camera, then tap a button. This panel closes on the first tap.
        </p>
        <p className={`remote-status${online ? " remote-status--on" : ""}`} role="status">
          {online ? "● Ready for a phone" : "○ Connecting to the relay…"}
        </p>
        <p className="remote-url">{url}</p>
        <button className="band" onClick={onDisconnect}>
          Disconnect remote
        </button>
      </div>
    </div>
  );
}
