import React, { useEffect, useRef, useState } from "react";

export function thumbnailPath(path) {
  return path.startsWith("media/") ? `media/thumbs/${path.slice(6)}.webp` : path;
}

export function LazyQuestionImage({ src, full = false, alt = "" }) {
  const imageRef = useRef(null);
  const [imageSrc, setImageSrc] = useState(full ? src : "");

  useEffect(() => {
    if (full || !imageRef.current) return undefined;
    const image = imageRef.current;
    if (!("IntersectionObserver" in window)) {
      setImageSrc(thumbnailPath(src));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setImageSrc(thumbnailPath(src));
        observer.disconnect();
      }
    }, { rootMargin: "300px 0px" });
    observer.observe(image);
    return () => observer.disconnect();
  }, [src, full]);

  return (
    <img
      ref={imageRef}
      src={imageSrc || undefined}
      alt={alt}
      onError={(event) => {
        if (!full && imageSrc !== src) setImageSrc(src);
        else event.currentTarget.onerror = null;
      }}
    />
  );
}

export function QuestionMedia({ question, full = false, onOpenImage }) {
  const [playing, setPlaying] = useState(false);
  if (question.video) {
    return (
      <div className="card-media">
        {playing ? (
          <video controls playsInline preload="metadata" autoPlay src={question.video} />
        ) : (
          <button className="video-play-btn" type="button" aria-label="Atskaņot ceļu satiksmes situācijas video" onClick={() => setPlaying(true)}>
            <span aria-hidden="true">▶</span>Skatīties video
          </button>
        )}
      </div>
    );
  }
  if (!question.img) return null;
  return (
    <div className="card-media">
      <button className="media-open-btn" type="button" aria-label="Palielināt ceļu satiksmes situācijas attēlu" onClick={(event) => onOpenImage(question.img, event.currentTarget)}>
        <LazyQuestionImage src={question.img} full={full} alt="Ceļu satiksmes situācija" />
        <span className="media-badge">Palielināt</span>
      </button>
    </div>
  );
}
