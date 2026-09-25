/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { usePresence } from "./usePresence";
import "./ImagePreview.css";

type PreviewImage = { id: string; name: string; data: string };
type PreviewProps = { images: readonly PreviewImage[]; activeId: string | null; onClose: () => void };

/** Enlarge local attachments without navigating away from the conversation. */
export function ImagePreview({ images, activeId, onClose }: PreviewProps) {
  const open = activeId !== null && images.some(image => image.id === activeId);
  const { present, exiting } = usePresence(open, 150);
  const retained = React.useRef<{ images: readonly PreviewImage[]; activeId: string | null }>({ images, activeId });
  React.useLayoutEffect(() => {
    if (open) retained.current = { images, activeId };
    else if (!present) retained.current = { images: [], activeId: null };
  }, [open, present, images, activeId]);
  const gallery = open ? { images, activeId } : retained.current;

  return present && gallery.activeId !== null ? createPortal(
    <PreviewDialog images={gallery.images} activeId={gallery.activeId} open={open} exiting={exiting} onClose={onClose} />,
    document.body,
  ) : null;
}

function PreviewDialog({ images, activeId, open, exiting, onClose }: {
  images: readonly PreviewImage[]; activeId: string; open: boolean; exiting: boolean; onClose: () => void;
}) {
  const backdrop = React.useRef<HTMLDivElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const [selection, setSelection] = React.useState({ initial: activeId, id: activeId });
  const selectedId = selection.initial === activeId ? selection.id : activeId;
  const found = images.findIndex(image => image.id === selectedId);
  const index = found < 0 ? Math.max(0, images.findIndex(image => image.id === activeId)) : found;
  const image = images[index];
  const [loaded, setLoaded] = React.useState<{ data: string; width: number; height: number } | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [zoomed, setZoomed] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const safeSource = /^data:image\/[a-z\d.+-]+(?:;[^,]*)?,/i.test(image?.data ?? "");
  const error = !safeSource || failed === image?.data;
  const ready = !error && loaded?.data === image?.data;

  React.useLayoutEffect(() => {
    if (open) setSelection({ initial: activeId, id: activeId });
  }, [open, activeId]);

  React.useLayoutEffect(() => {
    setLoaded(null); setFailed(null); setZoomed(false);
    if (stage.current) { stage.current.scrollLeft = 0; stage.current.scrollTop = 0; }
  }, [image?.id, image?.data]);

  React.useLayoutEffect(() => {
    if (!open) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus.current = previous;
    const surface = backdrop.current!;
    const siblings = [...document.body.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item !== surface);
    const previousInert = siblings.map(item => item.inert);
    siblings.forEach(item => { item.inert = true; });
    closeButton.current?.focus({ preventScroll: true });
    const containFocus = (event: FocusEvent) => {
      if (!surface.contains(event.target as Node)) closeButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      siblings.forEach((item, i) => { item.inert = previousInert[i]; });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  const navigate = (offset: number) => {
    if (images.length < 2) return;
    const next = images[(index + offset + images.length) % images.length];
    setSelection({ initial: activeId, id: next.id });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    else if (event.key === "ArrowLeft" && !event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); navigate(-1); }
    else if (event.key === "ArrowRight" && !event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); navigate(1); }
    else if (event.key === "Tab") {
      const buttons = [...backdrop.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
    }
  };

  if (!image) return null;
  return <div ref={backdrop} className="image-preview-backdrop" data-exiting={exiting || undefined}
    inert={!open || undefined} aria-hidden={!open || undefined}
    onClick={event => { event.stopPropagation(); if (open && event.target === event.currentTarget) onClose(); }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={handleKeyDown}>
    <section className="image-preview-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
      <header className="image-preview-toolbar">
        <div className="image-preview-info">
          <h2 className="image-preview-name" title={image.name}>{image.name}</h2>
          <span className="image-preview-details">{ready && loaded ? `${loaded.width} × ${loaded.height}` : "Image attachment"}</span>
        </div>
        <button type="button" className="image-preview-control image-preview-zoom" disabled={!ready}
          aria-label={zoomed ? "Fit image to window" : "Show actual size"} aria-pressed={zoomed}
          title={zoomed ? "Fit image to window" : "Show actual size"} onClick={() => setZoomed(value => !value)}>
          {zoomed ? "Fit" : "100%"}
        </button>
        <button ref={closeButton} type="button" className="image-preview-control" aria-label="Close image preview" title="Close image preview" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div ref={stage} className="image-preview-stage" data-zoomed={zoomed || undefined} aria-busy={!ready && !error}>
        {error ? <div className="image-preview-message" role="status">This image could not be loaded.</div> : <>
          {!ready && <div className="image-preview-message" role="status"><span className="image-preview-spinner" aria-hidden="true" />Loading image…</div>}
          <div className="image-preview-canvas">
            <img key={image.id} className="image-preview-image" src={image.data} alt={image.name} draggable={false}
              data-ready={ready || undefined}
              onLoad={event => setLoaded({ data: image.data, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(image.data)} />
          </div>
        </>}
      </div>
      {images.length > 1 && <footer className="image-preview-navigation">
        <button type="button" className="image-preview-control" aria-label="Previous image" title="Previous image" onClick={() => navigate(-1)}><Icon name="chevL" /></button>
        <span className="image-preview-position" aria-live="polite" aria-atomic="true">{index + 1} of {images.length}</span>
        <button type="button" className="image-preview-control" aria-label="Next image" title="Next image" onClick={() => navigate(1)}><Icon name="chevR" /></button>
      </footer>}
    </section>
  </div>;
}
