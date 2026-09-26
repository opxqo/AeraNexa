"use client";

import { useActionState } from "react";
import { createEnrollmentAction, type EnrollmentFormState } from "./actions";

export function EnrollmentForm() {
  const [state, formAction, pending] = useActionState<EnrollmentFormState, FormData>(createEnrollmentAction, {});
  return <section className="v2-block">
    <h2>一键安装并自动注册</h2>
    <p>在全新的 Alpine VPS 上以 root 执行生成的命令。节点装好后回调 AN，AN 通过下面填写的公网管理地址回连核对，成功后保存为停用连接，确认后在下方启用。</p>
    <form action={formAction}>
      <div className="admin-form-grid">
        <label className="v2-field"><span>名称</span><input name="name" maxLength={100} required /></label>
        <label className="v2-field"><span>公网管理地址（映射到节点 2053 端口）</span><input name="baseUrl" type="url" placeholder="https://203.0.113.9:36749" required /></label>
      </div>
      <div className="node-lab-save"><span /><button className="button button-primary" type="submit" disabled={pending}>{pending ? "生成中…" : "生成安装命令"}</button></div>
    </form>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.command ? <div className="node-lab-traffic">
      <p><strong>安装命令</strong>（注册码单次有效，{new Date(state.expiresAt ?? "").toLocaleString()} 前使用；离开页面后无法再次查看）</p>
      <textarea readOnly rows={4} value={state.command} style={{ width: "100%", fontFamily: "monospace" }} onFocus={(event) => event.currentTarget.select()} />
    </div> : null}
  </section>;
}
