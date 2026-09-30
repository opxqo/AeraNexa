"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { sanitizeHtml } from "@/components/api-ui";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Folder } from "@/components/ui/folder-component";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { DOC_CATEGORIES, FAQ_CATEGORY, KNOWLEDGE, type Article } from "@/lib/demo/panel-mock";
import { formatTime } from "./order-status";

/** shadcn has no Typography component, so the article body gets the usual prose rules here. */
const PROSE =
  "text-sm leading-relaxed text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_img]:max-w-full [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:overflow-x-auto [&_strong]:font-medium [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 first:[&>*]:mt-0";

const date = (article: Article) => formatTime(article.updatedAt).slice(0, 10);

export function KnowledgePage() {
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<Article | null>(null);

  const groups = useMemo(() => DOC_CATEGORIES.map((name) => ({ name, articles: KNOWLEDGE.filter((article) => article.category === name) })).filter((group) => group.articles.length > 0), []);
  const selected = groups.find((group) => group.name === category);

  if (KNOWLEDGE.length === 0) {
    return (
      <Page>
        <PageHeader title="使用文档" description="客户端配置指引" />
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>管理员尚未发布任何文档</EmptyTitle>
            <EmptyDescription>有问题可以先提交工单。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="使用文档" description="客户端配置指引" />

      <div className="@container">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 @2xl:grid-cols-4">
          {groups.map((group) => {
            const active = group.name === category;
            return (
              <button
                key={group.name}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(active ? null : group.name)}
                className="group/folder flex flex-col items-center gap-1 rounded-xl px-2 pt-14 pb-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:pt-20"
              >
                <Folder size={0.46} color={active ? "black" : "stone"} open={active || undefined} className="sm:hidden" />
                <Folder size={0.6} color={active ? "black" : "stone"} open={active || undefined} className="max-sm:hidden" />
                <span className="text-sm font-medium">{group.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{group.articles.length} 篇</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            {selected.name} <span className="font-normal text-muted-foreground">· {selected.articles.length} 篇</span>
          </h2>
          {selected.name === FAQ_CATEGORY ? (
            <div className="rounded-xl border bg-card px-4">
              <Accordion>
                {selected.articles.map((article) => (
                  <AccordionItem key={article.id} value={String(article.id)}>
                    <AccordionTrigger className="py-3">{article.title}</AccordionTrigger>
                    <AccordionContent>
                      <Body html={article.body} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ) : (
            <ArticleList articles={selected.articles} onOpen={setOpen} />
          )}
        </section>
      ) : (
        <p className="text-center text-sm text-muted-foreground">选择一个分类开始阅读</p>
      )}

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            <DialogDescription>
              {open?.category} · 更新于 {open ? date(open) : ""}
            </DialogDescription>
          </DialogHeader>
          {open && <Body html={open.body} />}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function Body({ html }: { html: string }) {
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  return safe ? <div className={PROSE} dangerouslySetInnerHTML={{ __html: safe }} /> : <p className="text-sm text-muted-foreground">该文档暂无正文内容。</p>;
}

function ArticleList({ articles, onOpen }: { articles: Article[]; onOpen: (article: Article) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {articles.map((article, index) => (
        <Fragment key={article.id}>
          {index > 0 && <Separator />}
          <Item className="cursor-pointer rounded-none px-4 py-3 text-left hover:bg-muted/50" render={<button type="button" onClick={() => onOpen(article)} />}>
            <ItemContent>
              <ItemTitle>
                {article.title}
              </ItemTitle>
            </ItemContent>
            <ItemActions className="text-xs text-muted-foreground tabular-nums">
              <span className="max-sm:hidden">{date(article)}</span>
              <ChevronRight className="size-4" />
            </ItemActions>
          </Item>
        </Fragment>
      ))}
    </div>
  );
}
