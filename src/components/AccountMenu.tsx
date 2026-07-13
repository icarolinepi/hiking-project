"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

type AccountMenuProps = {
  user: {
    name: string;
    profile: string | null;
  };
  compareLabel: string;
  compareActive: boolean;
  onCompare: () => void;
  onShare: () => void;
  shareLabel: string;
  shareBusy: boolean;
  onSync: () => void;
  syncBusy: boolean;
  onLogout: () => void;
};

function UserChip({
  user,
  id,
}: {
  user: AccountMenuProps["user"];
  id?: string;
}) {
  return (
    <div className="user-chip">
      {user.profile ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.profile} alt="" className="avatar" />
      ) : null}
      <span id={id}>{user.name}</span>
    </div>
  );
}

function ActionButtons({
  compareLabel,
  compareActive,
  onCompare,
  onShare,
  shareLabel,
  shareBusy,
  onSync,
  syncBusy,
  onLogout,
}: Omit<AccountMenuProps, "user">) {
  return (
    <>
      <button
        type="button"
        className={`btn ${compareActive ? "btn-primary" : "btn-ghost"}`}
        onClick={onCompare}
      >
        {compareLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onShare}
        disabled={shareBusy}
      >
        {shareLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onSync}
        disabled={syncBusy}
      >
        {syncBusy ? "Синхронізую…" : "Оновити зі Strava"}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onLogout}>
        Вийти
      </button>
    </>
  );
}

export function AccountMenu(props: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  const drawer =
    mounted &&
    createPortal(
      <>
        {open ? (
          <button
            type="button"
            className="account-drawer-backdrop"
            aria-label="Закрити меню"
            onClick={() => setOpen(false)}
          />
        ) : null}
        <aside
          id="account-drawer"
          className={`account-drawer${open ? " is-open" : ""}`}
          aria-labelledby={titleId}
          aria-hidden={!open}
        >
          <div className="account-drawer-head">
            <UserChip user={props.user} id={titleId} />
            <button
              type="button"
              className="account-drawer-close"
              aria-label="Закрити"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="account-drawer-actions">
            <ActionButtons
              {...props}
              onCompare={() => run(props.onCompare)}
              onShare={() => run(props.onShare)}
              onSync={() => run(props.onSync)}
              onLogout={() => run(props.onLogout)}
            />
          </div>
        </aside>
      </>,
      document.body,
    );

  return (
    <>
      <div className="account-menu-mobile">
        <button
          type="button"
          className={`menu-toggle${open ? " is-open" : ""}`}
          aria-expanded={open}
          aria-controls="account-drawer"
          aria-label={open ? "Закрити меню" : "Відкрити меню"}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden />
          <span aria-hidden />
          <span aria-hidden />
        </button>
      </div>

      {drawer}

      <div className="account-actions-desktop topbar-actions">
        <UserChip user={props.user} />
        <ActionButtons {...props} />
      </div>
    </>
  );
}
