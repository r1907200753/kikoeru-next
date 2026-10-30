import { useState } from 'react';

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const pages: number[] = [];
  for (let value = start; value <= end; value += 1) {
    pages.push(value);
  }
  return pages;
}

export function Pagination({
  page,
  totalPages,
  onChange,
  label,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  label: string;
}) {
  const [jumpInput, setJumpInput] = useState('');

  if (totalPages <= 1) {
    return null;
  }

  const pages = pageWindow(page, totalPages);
  const goTo = (target: number) => {
    const next = Math.min(totalPages, Math.max(1, target));
    if (next !== page) {
      onChange(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <nav className="pagination" aria-label={label}>
      <button
        type="button"
        className="pagination-btn"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
      >
        上一页
      </button>
      {pages[0] !== 1 ? (
        <>
          <button type="button" className="pagination-btn" onClick={() => goTo(1)}>
            1
          </button>
          {pages[0] !== 2 ? <span className="pagination-gap">…</span> : null}
        </>
      ) : null}
      {pages.map((value) => (
        <button
          key={value}
          type="button"
          className={`pagination-btn${value === page ? ' is-active' : ''}`}
          onClick={() => goTo(value)}
          aria-current={value === page ? 'page' : undefined}
        >
          {value}
        </button>
      ))}
      {pages[pages.length - 1] !== totalPages ? (
        <>
          {pages[pages.length - 1] !== totalPages - 1 ? (
            <span className="pagination-gap">…</span>
          ) : null}
          <button type="button" className="pagination-btn" onClick={() => goTo(totalPages)}>
            {totalPages}
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="pagination-btn"
        onClick={() => goTo(page + 1)}
        disabled={page >= totalPages}
      >
        下一页
      </button>
      <form
        className="pagination-jump"
        onSubmit={(event) => {
          event.preventDefault();
          const target = Number.parseInt(jumpInput, 10);
          if (Number.isFinite(target)) {
            goTo(target);
            setJumpInput('');
          }
        }}
      >
        <span>跳至</span>
        <input
          value={jumpInput}
          onChange={(event) => setJumpInput(event.target.value)}
          inputMode="numeric"
          aria-label="跳转页码"
        />
        <span>/ {totalPages}</span>
      </form>
    </nav>
  );
}
