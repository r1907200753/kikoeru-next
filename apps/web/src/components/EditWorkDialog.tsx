import { useEffect, useState } from 'react';
import {
  updateWorkMetadata,
  type WorkDetail,
  type WorkMetadataInput,
} from '../api';
import { CloseIcon, EditIcon } from '../icons';

function splitList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of value.split(/[,，、]/)) {
    const item = part.trim();
    if (item && !seen.has(item)) {
      seen.add(item);
      items.push(item);
    }
  }
  return items;
}

export function EditWorkDialog({
  open,
  work,
  onClose,
  onSaved,
}: {
  open: boolean;
  work: WorkDetail;
  onClose: () => void;
  onSaved: (work: WorkDetail) => void;
}) {
  const [title, setTitle] = useState('');
  const [circle, setCircle] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [workType, setWorkType] = useState('');
  const [tags, setTags] = useState('');
  const [vas, setVas] = useState('');
  const [rating, setRating] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(work.title);
    setCircle(work.circle);
    setReleaseDate(work.releaseDate);
    setWorkType(work.workType);
    setTags(work.tags.join(', '));
    setVas(work.vas.join(', '));
    setRating(work.rating === null ? '' : String(work.rating));
    setPrice(work.priceYen === null ? '' : String(work.priceYen));
    setSaving(false);
    setError('');
  }, [open, work]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const save = async () => {
    if (saving) {
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('标题不能为空');
      return;
    }
    const ratingValue = rating.trim() === '' ? null : Number(rating);
    if (ratingValue !== null && (!Number.isFinite(ratingValue) || ratingValue < 0 || ratingValue > 5)) {
      setError('评分需要在 0 到 5 之间');
      return;
    }
    const priceValue = price.trim() === '' ? null : Number(price);
    if (priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0)) {
      setError('价格需要是非负整数');
      return;
    }
    const input: WorkMetadataInput = {
      title: trimmedTitle,
      circle: circle.trim(),
      releaseDate: releaseDate.trim(),
      workType: workType.trim(),
      tags: splitList(tags),
      vas: splitList(vas),
      rating: ratingValue === null ? null : Math.round(ratingValue * 100) / 100,
      priceYen: priceValue === null ? null : Math.round(priceValue),
    };
    setSaving(true);
    setError('');
    try {
      const next = await updateWorkMetadata(work.code, input);
      onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-card edit-work-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-work-title"
      >
        <header className="modal-head">
          <h2 id="edit-work-title">
            <EditIcon /> 修改作品信息
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭修改信息">
            <CloseIcon />
          </button>
        </header>

        <p className="settings-hint edit-work-hint">
          手动修改后，重新刮削会保留这些信息，但仍可以刷新封面。标签与声优用逗号分隔。
        </p>

        <div className="edit-work-grid">
          <label className="settings-field edit-work-field--wide">
            <span>标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="作品标题"
            />
          </label>
          <label className="settings-field">
            <span>社团 / Circle</span>
            <input value={circle} onChange={(event) => setCircle(event.target.value)} />
          </label>
          <label className="settings-field">
            <span>发售日</span>
            <input
              value={releaseDate}
              onChange={(event) => setReleaseDate(event.target.value)}
              placeholder="2024-08-30"
            />
          </label>
          <label className="settings-field">
            <span>类型</span>
            <input
              value={workType}
              onChange={(event) => setWorkType(event.target.value)}
              placeholder="音声作品"
            />
          </label>
          <label className="settings-field">
            <span>评分（0～5）</span>
            <input
              value={rating}
              onChange={(event) => setRating(event.target.value)}
              inputMode="decimal"
              placeholder="留空表示未评分"
            />
          </label>
          <label className="settings-field">
            <span>价格（日元）</span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="numeric"
              placeholder="留空表示未知"
            />
          </label>
          <label className="settings-field edit-work-field--wide">
            <span>标签</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="耳かき, バイノーラル, ASMR"
            />
          </label>
          <label className="settings-field edit-work-field--wide">
            <span>声优 / CV</span>
            <input
              value={vas}
              onChange={(event) => setVas(event.target.value)}
              placeholder="用逗号分隔"
            />
          </label>
        </div>

        {error ? (
          <div className="notice notice--error notice--inline" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="edit-work-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
