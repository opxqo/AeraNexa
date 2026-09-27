"use client";

import { useActionState } from "react";
import { createEnrollmentAction, type EnrollmentFormState } from "./actions";
import styles from "./node-connections.module.css";

export function EnrollmentForm() {
  const [state, formAction, pending] = useActionState<EnrollmentFormState, FormData>(createEnrollmentAction, {});
  return <div className={styles.enrollment}>
    <p className={styles.helper}>在全新的 Alpine VPS 上以 root 执行安装命令。节点回调后，AN 使用公网管理地址核对连接；登记成功后仍需在节点详情中启用。</p>
    <form action={formAction} className={styles.form}>
      <div className={styles.formGrid}>
        <label className="v2-field"><span>名称</span><input name="name" maxLength={100} required /></label>
        <label className="v2-field"><span>公网管理地址（映射到节点 2053 端口）</span><input name="baseUrl" type="url" placeholder="https://203.0.113.9:36749" required /></label>
      </div>
      <div className={styles.formFooter}><span /><button className="button button-primary" type="submit" disabled={pending}>{pending ? "生成中…" : "生成安装命令"}</button></div>
    </form>
    {state.error ? <p className={`${styles.message} ${styles.error}`} role="alert">{state.error}</p> : null}
    {state.command ? <div className={styles.commandBox} role="status">
      <p><strong>安装命令已生成</strong><span>注册码单次有效，{new Date(state.expiresAt ?? "").toLocaleString()} 前使用；离开页面后无法再次查看。</span></p>
      <textarea aria-label="3x-node 安装命令" readOnly rows={4} value={state.command} onFocus={(event) => event.currentTarget.select()} />
    </div> : null}
  </div>;
}
