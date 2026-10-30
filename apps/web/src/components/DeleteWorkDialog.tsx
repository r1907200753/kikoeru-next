import { useEffect, useState } from 'react';
import { deleteWork, type WorkDetail } from '../api';
import { CloseIcon, TrashIcon } from '../icons';

export function DeleteWorkDialog({
  open,
  work,
  onClose,
  onDeleted,
}: {
  open: boolean;
  work: WorkDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    setDeleteFiles(false);
    setDeleting(false);
    setError('');
  }, [open, work.code]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, deleting]);

  if (!open) {
    return null;
  }

  const remove = async () => {
    if (deleting) {
      return;
    }
    setDeleting(true);
    setError('');
    try {
      await deleteWork(work.code, deleteFiles);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) {
          onClose();
        }
      }}
    >
      <div
        className="modal-card delete-work-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-work-title"
      >
        <header className="modal-head">
          <h2 id="delete-work-title">
            <TrashIcon /> 从曲库删除
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={deleting}
            aria-label="关闭删除作品"
          >
            <CloseIcon />
          </button>
        </header>

        <p className="settings-hint delete-work-hint">
          将从曲库移除「{work.title}」。不勾选下面的选项时，只删除曲库记录；如果本地文件仍然存在，下次扫描会重新入库。
        </p>

        <label className="delete-work-check">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(event) => setDeleteFiles(event.target.checked)}
            disabled={deleting}
          />
          <span>
            <strong>同时删除本地文件</strong>
            <small>永久删除整个作品目录，包括音频、图片、字幕和其他文件，无法恢复。</small>
          </span>
        </label>

        {deleteFiles ? (
          <div className="notice notice--error notice--inline" role="alert">
            <span>本地文件会被永久删除，请确认这个作品的目录不再需要。</span>
          </div>
        ) : null}

        {error ? (
          <div className="notice notice--error notice--inline" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="edit-work-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={deleting}>
            取消
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={deleting}>
            {deleting ? '删除中…' : deleteFiles ? '删除作品与本地文件' : '从曲库移除'}
          </button>
        </div>
      </div>
    </div>
  );
}
