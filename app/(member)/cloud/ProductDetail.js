"use client";
// PRD｜产品详情 — daily-flow-spec §3. Internal view shows the price; the shared card JPG does not.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentQuote, useMember } from "../../member-context";
import { createProductCard } from "../../product-card";
import { canShareFile, downloadFile } from "../../share";
import { InlineError, Sheet, useToast } from "../../ui";
import Icon from "../../icons";

export default function ProductDetail({ product, onClose, onAdd, onRenew }) {
  const member = useMember(), quote = useCurrentQuote(), toast = useToast();
  const brand = quote.brand;
  const [card, setCard] = useState(null), [cardState, setCardState] = useState("idle"), [cardError, setCardError] = useState("");
  const [attempt, setAttempt] = useState(0), [sharing, setSharing] = useState(false), [added, setAdded] = useState(false);

  // PRD.CARD_STATE: prepare the shareable JPG as soon as the brand is known.
  useEffect(() => {
    if (!brand) return;
    if (product.imageError) { setCardState("error"); setCardError("照片暂时无法读取，请刷新或重新上传后再生成卡片。"); return; }
    let cancelled = false;
    setCardState("preparing"); setCard(null); setCardError("");
    createProductCard(product, brand, { name: member.displayName, whatsapp: member.whatsapp })
      .then(file => { if (!cancelled) { setCard(file); setCardState("ready"); } })
      .catch(err => { if (!cancelled) { setCardState("error"); setCardError(`卡片生成失败：${err.message || "请重试。"}`); } });
    return () => { cancelled = true; };
  }, [product, brand, attempt]);

  // Signed image links last five minutes.
  useEffect(() => {
    const timer = setInterval(() => { onRenew().catch(() => {}); }, 120000);
    return () => clearInterval(timer);
  }, [product.id]);

  async function share() {
    if (!card || sharing) return;
    if (!canShareFile(card)) { downloadFile(card); toast("已为你下载，可在相册／文件中发送"); return; }
    setSharing(true);
    try { await navigator.share({ files: [card] }); }
    catch (err) { if (err.name !== "AbortError") { downloadFile(card); toast("分享未完成，已为你下载卡片"); } }
    finally { setSharing(false); }
  }

  function add() {
    if (onAdd(product)) { setAdded(true); setTimeout(() => setAdded(false), 1500); }
  }

  const preparing = cardState === "preparing" || (!brand && cardState === "idle");
  const category = product.category || "未分类";

  return (
    <Sheet title="产品详情" subtitle={member.name} onClose={onClose} closeLabel="关闭产品详情" footer={<>
      <div className="btn-row">
        <button type="button" className="btn btn-share" disabled={!card || sharing} onClick={share}>{preparing ? "准备中…" : sharing ? "正在分享…" : "分享卡片"}</button>
        <button type="button" className="btn btn-primary" disabled={!quote.ready || quote.busy} onClick={add}>{added ? <><Icon name="check" size={18} strokeWidth={2.5} />已加入</> : "加入报价"}</button>
      </div>
      {quote.items?.length > 0 && <Link href="/cloud/quote" className="text-btn" style={{ justifySelf: "center" }} onClick={onClose}>查看当前报价（{quote.items.length} 项）<Icon name="arrowRight" size={16} /></Link>}
    </>}>
      <div className="prd-image">
        {product.image ? <img src={product.image} alt={product.name} /> : <div className="img-ph">暂无照片</div>}
      </div>
      <div className="row-between">
        <span className="small muted">{cardState === "ready" ? "对外卡片不显示价格" : ""}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!card} onClick={() => downloadFile(card)}>
          <Icon name="download" size={16} />{preparing ? "准备中…" : "下载卡片"}</button>
      </div>
      {cardState === "error" && <InlineError onRetry={() => setAttempt(value => value + 1)} retryLabel="重新生成">{cardError}</InlineError>}
      <div className="stack-sm">
        <h3 className="prd-name">{product.name} <small>/ {product.unit || "件"}</small>{product.is_service && <> <span className="chip">服务</span></>}</h3>
        <p className="muted">{product.serial}</p>
        <p className="prd-price">RM {Number(product.price).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        {!!product.tags?.length && <div className="chips">{product.tags.map((tag, i) => <span className="chip" key={`${tag}-${i}`}>{tag}</span>)}</div>}
        <p className="small">分类：{category}</p>
        {product.description && <p className="muted preserveLines">{product.description}</p>}
      </div>
    </Sheet>
  );
}
