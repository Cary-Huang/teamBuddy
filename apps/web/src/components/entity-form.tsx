"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import { ApiClientError } from "../lib/api/client.js";

export function EntityForm({
  children,
  submitLabel,
  onSubmit,
  onSuccess,
}: {
  children: ReactNode;
  submitLabel: string;
  onSubmit: (formData: FormData) => Promise<unknown>;
  onSuccess?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [messageKind, setMessageKind] = useState<"success" | "error">();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage(undefined);
    setMessageKind(undefined);
    try {
      await onSubmit(new FormData(form));
      form.reset();
      setMessage("已保存。");
      setMessageKind("success");
      onSuccess?.();
    } catch (error) {
      setMessage(toMessage(error));
      setMessageKind("error");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="entity-form" onSubmit={submit}>
      {children}
      <div className="form-actions">
        <button disabled={pending} type="submit">
          {pending ? "保存中…" : submitLabel}
        </button>
        {message ? (
          <p role={messageKind === "error" ? "alert" : "status"}>{message}</p>
        ) : null}
      </div>
    </form>
  );
}

const toMessage = (error: unknown): string =>
  error instanceof ApiClientError
    ? `${error.message}（${error.code}）`
    : "操作未完成，请稍后重试。";
