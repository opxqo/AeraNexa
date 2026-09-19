"use client";

import React, { useEffect, useState, createContext, useContext, useCallback } from "react";
import { X, CheckCircle2, AlertTriangle, Info, AlertCircle } from "lucide-react";

/* -------------------------------------------------------------------------
   Toast Message System (AntD 4 message.info / message.success 风格)
------------------------------------------------------------------------- */

type ToastType = "success" | "info" | "warning" | "error";

interface ToastItem {
  id: string;
  type: ToastType;
  content: string;
}

interface ToastContextType {
  showToast: (content: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((content: string, type: ToastType = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, content }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="ant-message" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="ant-message-notice">
            <div className="ant-message-notice-content">
              {toast.type === "success" && <CheckCircle2 className="ant-message-icon success" size={16} />}
              {toast.type === "info" && <Info className="ant-message-icon info" size={16} />}
              {toast.type === "warning" && <AlertTriangle className="ant-message-icon warning" size={16} />}
              {toast.type === "error" && <AlertCircle className="ant-message-icon error" size={16} />}
              <span>{toast.content}</span>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* -------------------------------------------------------------------------
   Modal Component (AntD 4 经典居中模态框)
------------------------------------------------------------------------- */

interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  onClose: () => void;
  onOk?: () => void;
  okText?: string;
  cancelText?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number | string;
  maskClosable?: boolean;
}

export function Modal({
  open,
  title,
  onClose,
  onOk,
  okText = "确定",
  cancelText = "取消",
  children,
  footer,
  width = 520,
  maskClosable = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const defaultFooter = (
    <div className="ant-modal-footer-inner">
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        {cancelText}
      </button>
      {onOk && (
        <button type="button" className="btn btn-primary" onClick={onOk}>
          {okText}
        </button>
      )}
    </div>
  );

  return (
    <div className="ant-modal-root">
      <div
        className="ant-modal-mask"
        onClick={() => {
          if (maskClosable) onClose();
        }}
      />
      <div className="ant-modal-wrap" tabIndex={-1}>
        <div className="ant-modal" style={{ width }} role="dialog">
          <div className="ant-modal-content">
            <button
              type="button"
              className="ant-modal-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X size={16} />
            </button>
            {title && (
              <div className="ant-modal-header">
                <div className="ant-modal-title">{title}</div>
              </div>
            )}
            <div className="ant-modal-body">{children}</div>
            {footer !== null && (
              <div className="ant-modal-footer">
                {footer !== undefined ? footer : defaultFooter}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Confirm Modal (二次确认对话框)
------------------------------------------------------------------------- */

interface ConfirmModalProps {
  open: boolean;
  title: string;
  content: React.ReactNode;
  okText?: string;
  cancelText?: string;
  okType?: "primary" | "danger";
  onOk: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  content,
  okText = "确定",
  cancelText = "取消",
  okType = "primary",
  onOk,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <Modal
      open={open}
      width={416}
      onClose={onCancel}
      footer={
        <div className="ant-modal-confirm-btns">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${okType === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onOk}
          >
            {okText}
          </button>
        </div>
      }
    >
      <div className="ant-modal-confirm-body">
        <AlertTriangle className="ant-modal-confirm-icon warning" size={24} />
        <div className="ant-modal-confirm-content-wrap">
          <h4 className="ant-modal-confirm-title">{title}</h4>
          <div className="ant-modal-confirm-content">{content}</div>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------
   Drawer Component (AntD 4 经典右侧滑出抽屉)
------------------------------------------------------------------------- */

interface DrawerProps {
  open: boolean;
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: number | string;
}

export function Drawer({
  open,
  title,
  onClose,
  children,
  width = 360,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ant-drawer-root">
      <div className="ant-drawer-mask" onClick={onClose} />
      <div
        className="ant-drawer-content-wrapper"
        style={{ width, maxWidth: "100vw" }}
      >
        <div className="ant-drawer-content">
          <div className="ant-drawer-header">
            <div className="ant-drawer-title">{title}</div>
            <button
              type="button"
              className="ant-drawer-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <div className="ant-drawer-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
