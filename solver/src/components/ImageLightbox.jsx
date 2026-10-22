import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

export default function ImageLightbox({ image, onClose, returnFocus }) {
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [onClose, returnFocus]);
  if (!image) return null;

  const zoomLabel = zoomed ? "Samazināt attēlu" : "Palielināt attēlu";
  const zoomIcon = zoomed ? "－" : "＋";

  return (
    <div
      className="lightbox-modal active"
      role="dialog"
      aria-modal="true"
      aria-label="Ceļu satiksmes situācijas attēls"
      aria-hidden="false"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        id="lightbox-zoom"
        className="lightbox-zoom"
        title={zoomLabel}
        aria-label={zoomLabel}
        onClick={() => setZoomed(!zoomed)}
      >
        {zoomIcon}
      </button>
      <button ref={closeRef} id="lightbox-close" className="lightbox-close" aria-label="Aizvērt" onClick={onClose}>✕</button>
      <div id="lightbox-content" className={`lightbox-content ${zoomed ? "zoomed" : ""}`}>
        <img id="lightbox-img" src={image} alt="Ceļu satiksmes situācija tuvplānā" />
      </div>
    </div>
  );
}
