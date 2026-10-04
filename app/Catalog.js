"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Quotation from "./Quotation";
import { MAX_UNIT_PRICE, moneyToCents } from "./quotation-utils";
import { canShareFile, downloadFile } from "./share";
import { prepareUploadImage } from "./images";
import { createProductCard } from "./product-card";
import { Button, DesignIcon, EmptyState, FloatingAction, Modal, NavLink, PageHeader, Status } from "./ui";

export default function Catalog({ cloud, quotation }) {
  const items = cloud.items;
  const [saving, setSaving] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const pendingId = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const imageUploadToken = useRef(0);
  const [formError, setFormError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const quotationItems = quotation.items || [];
  const quotationReady = quotation.ready;
  const quotationError = quotation.error;
  const [detailMessage, setDetailMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const shareCompany = quotation.brand || { name: "", contact: "", logo: "" };
  const companyReady = !!quotation.brand && !quotation.brand.logoError;
  const companyError = quotation.brand?.logoError;
  const [productCard, setProductCard] = useState(null);
  const [cardGenerating, setCardGenerating] = useState(false);
  const [cardAttempt, setCardAttempt] = useState(0);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [completedPdf, setCompletedPdf] = useState(null);
  const [pdfMessage, setPdfMessage] = useState("");
  const detailDialog = useRef(null);

  const [serial, setSerial] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState("");

  useEffect(() => {
    if (!cloud.canManage) { resetForm(); setOpen(false); }
  }, [cloud.canManage]);

  useEffect(() => {
    if (!cloud || !selectedProduct) return;
    const latest = items.find(item => item.id === selectedProduct.id);
    if (!latest) setSelectedProduct(null);
    else if (latest.image !== selectedProduct.image || latest.revision !== selectedProduct.revision) setSelectedProduct(latest);
  }, [items, !!cloud, selectedProduct]);

  useEffect(() => {
    if (!selectedProduct || !companyReady) return;
    if (selectedProduct.imageError) {
      setProductCard(null); setCardGenerating(false);
      setDetailMessage("照片暂时无法读取，请刷新或重新上传后生成卡片。");
      return;
    }
    let cancelled = false;
    setCardGenerating(true);
    setProductCard(null);
    createProductCard(selectedProduct, shareCompany)
      .then(file => { if (!cancelled) setProductCard(file); })
      .catch(err => { if (!cancelled) setDetailMessage(`产品卡片生成失败：${err.message || "请重试。"}`); })
      .finally(() => { if (!cancelled) setCardGenerating(false); });
    return () => { cancelled = true; };
  }, [selectedProduct, shareCompany, companyReady, cardAttempt]);

  useEffect(() => {
    if (!selectedProduct) return;
    const dialog = detailDialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedProduct]);

  const quotationCount = quotationItems.reduce((sum, item) => sum + item.quantity, 0);

  function openProductDetail(item) {
    setDetailMessage("");
    setProductCard(null);
    setSelectedProduct(item);
  }

  async function shareProductCard() {
    if (!productCard || sharing) return;
    setDetailMessage("");
    if (!canShareFile(productCard)) {
      setDetailMessage("此浏览器无法直接分享卡片。请下载产品卡片，再在 WhatsApp 中选择这张图片发送。");
      return;
    }
    setSharing(true);
    try {
      // The prepared JPG contains all product details, with no separate caption to lose.
      await navigator.share({ files: [productCard] });
    } catch (err) {
      if (err.name !== "AbortError") setDetailMessage("卡片分享未完成。请下载产品卡片后在 WhatsApp 中发送。");
    } finally {
      setSharing(false);
    }
  }

  function viewQuotation() {
    setSelectedProduct(null);
    setQuotationOpen(true);
  }

  function startNewQuotation() {
    if (!quotationReady || quotation.busy || saving || !quotation.startNew()) return;
    setSelectedProduct(null);
    setQuotationOpen(false);
  }

  async function addToQuotation(item) {
    const unitPrice = Number(item.price);
    if (moneyToCents(item.price) === null || unitPrice > MAX_UNIT_PRICE) {
      setDetailMessage("产品价格无效，无法加入报价清单。");
      return;
    }

    const added = quotation.add(item);
    setDetailMessage(added ? "已加入当前报价，生成／分享时自动保存。" : "未能加入，请查看报价错误提示。");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const hay = [item.serial, item.name, ...(item.tags || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  function resetForm() {
    imageUploadToken.current += 1;
    setImageLoading(false);
    setFormError("");
    setEditingId(null);
    pendingId.current = null;
    setEditingRecord(null);
    setSerial("");
    setName("");
    setTags("");
    setPrice("");
    setImage("");
  }

  function editItem(item) {
    resetForm();
    setEditingId(item.id);
    setEditingRecord(item);
    setSerial(item.serial);
    setName(item.name);
    setTags((item.tags || []).join(", "));
    setPrice(String(item.price));
    setImage(item.image || "");
    setOpen(true);
  }

  function closeForm() {
    if (saving) return;
    resetForm();
    setOpen(false);
  }

  async function addItem(e) {
    e.preventDefault();
    if (saving || imageLoading || !serial.trim() || !name.trim() || !price.trim()) return;

    const priceCents = moneyToCents(price.trim().replace(/^\./, "0."));
    if (priceCents === null || priceCents / 100 > MAX_UNIT_PRICE) {
      setFormError("请输入有效的非负价格，最多两位小数，且不超过 RM 9,999,999.99。");
      return;
    }

    const newItem = {
      id: editingId || (pendingId.current ||= crypto.randomUUID()),
      serial: serial.trim(),
      name: name.trim(),
      tags: tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      price: (priceCents / 100).toFixed(2),
      image
    };

    setSaving(true);
    try {
      await cloud.save(newItem, editingRecord);
      resetForm(); setOpen(false);
    } catch (err) { setFormError(`保存失败：${err.message}。表单仍保留，请检查网络后重试。`); }
    finally { setSaving(false); }
  }

  async function deleteItem(id) {
    if (saving) return;
    if (!window.confirm("确定删除这个产品吗？")) return;
    setSaving(true);
    try { await cloud.remove(items.find(item => item.id === id)); setCatalogError(""); }
    catch (err) { setCatalogError(`删除失败：${err.message}`); }
    finally { setSaving(false); }
  }

  async function onImageChange(file) {
    if (!file) return;
    const token = ++imageUploadToken.current;
    setImageLoading(true);
    setFormError("");
    try {
      const converted = await prepareUploadImage(file);
      if (imageUploadToken.current === token) setImage(converted);
    } catch (err) {
      if (imageUploadToken.current === token) setFormError(err.message || "图片转换失败，请重试。");
    } finally {
      if (imageUploadToken.current === token) setImageLoading(false);
    }
  }

  if (quotationOpen && quotationReady) {
    return <Quotation quotation={quotation} context={cloud.context} cloudError={cloud.error} onBack={() => setQuotationOpen(false)}
      onComplete={(file, id) => { if (quotation.complete(id)) { setCompletedPdf(file); setPdfMessage("报价已自动保存，当前已开始新报价。"); setQuotationOpen(false); } }} />;
  }

  return (
    <main className="page catalogPage">
      <PageHeader icon="profile" title="公司云端产品" subtitle={cloud.context.email}>
        <NavLink href="/account" className="profileLink">公司账号</NavLink>
      </PageHeader>
      <div className="companyStrip">
        <span className="companyPill">{cloud.name}</span>
        <span className="rolePill">{cloud.context.role === "admin" ? "管理员" : cloud.canManage ? "销售员 · 产品管理" : "销售员"}</span>
      </div>
      <nav className="workspaceNav" aria-label="公司工作区">
        <NavLink href={`/quotations?company=${cloud.context.companyId}`}>已保存报价</NavLink>
        {cloud.context.role === "admin" && <>
          <NavLink href={`/team?company=${cloud.context.companyId}#invite`}>邀请员工</NavLink>
          <NavLink href={`/team?company=${cloud.context.companyId}`}>员工与邀请</NavLink>
          <NavLink href={`/brand?company=${cloud.context.companyId}`}>公司品牌</NavLink>
        </>}
      </nav>
      {cloud.context.memberships.length > 1 && <label className="companySelector">当前公司
        <select value={cloud.context.companyId} disabled={cloud.busy} onChange={e => window.location.assign(`/cloud?company=${e.target.value}`)}>
          {cloud.context.memberships.map(m => <option key={m.company_id} value={m.company_id}>{m.companies?.name}</option>)}
        </select>
      </label>}
      <div className="catalogToolbar">
        <div><span className="fieldHint">当前报价</span><p className="activeQuotation">{quotation.row?.revision ? `正在编辑：${quotation.details.number}` : "新报价"}</p></div>
        <span className="badge">{items.length} 项产品</span>
      </div>
      <div className="catalogActions">
        <NavLink href={`/quotations?company=${cloud.context.companyId}`}>选择报价</NavLink>
        <Button disabled={cloud.busy || cloud.loading} onClick={cloud.refresh}>刷新云端产品</Button>
        <Button className="newQuotationButton" disabled={!quotationReady || quotation.busy || saving} onClick={startNewQuotation}>＋ 新建报价单</Button>
      </div>
      <Status>{quotation.dirty ? "当前报价有未保存修改；生成／分享时自动保存。" : quotation.message}</Status>
      <Status>{cloud.loading ? "正在读取云端产品…" : cloud.message}</Status>
      <Status error>{cloud.error}</Status>
      <details className="workspaceInfo"><summary>云端资料与权限</summary>
        <p>产品、报价、客户资料和品牌保存在公司云端。你的产品权限：{cloud.canManage ? "可管理（新增、编辑、删除）" : "仅查看与分享"}。员工与权限设置仅限管理员。</p>
        <p>其他设备更新后，请刷新读取。图片链接会定期续期，已下载或分享的内容无法撤回。</p>
        <Button onClick={() => void quotation.reload()} disabled={quotation.busy}>重新读取报价与品牌</Button>
      </details>
      {completedPdf && <div className="notice pdfActions">
        <p role="status">{pdfMessage}</p>
        <button type="button" onClick={() => downloadFile(completedPdf)}>下载刚生成的 PDF</button>
        <button type="button" disabled={sharing} onClick={async () => {
          if (!canShareFile(completedPdf)) { setPdfMessage("此浏览器无法直接分享 PDF，请下载后通过 WhatsApp 文档附件发送。"); return; }
          setSharing(true);
          try { await navigator.share({ files: [completedPdf], title: "SalesGo Quotation" }); setPdfMessage("已完成刚生成 PDF 的分享；当前报价清单保持不变。"); }
          catch (err) { setPdfMessage(err.name === "AbortError" ? "分享已取消，PDF 仍可下载或重试分享。" : "分享未完成，请下载 PDF 后发送。"); }
          finally { setSharing(false); }
        }}>分享刚生成的 PDF</button>
      </div>}
      {quotationError && <p className="quotationError" role="alert">{quotationError}</p>}
      {catalogError && <p className="quotationError" role="alert">{catalogError}</p>}
      {companyError && <p className="quotationError" role="alert">{companyError}</p>}

      <div className="searchWrap">
        <span className="searchIcon"><DesignIcon name="search" /></span>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索产品编号、名称、标签..."
          aria-label="搜索产品"
        />
        {query && (
          <button className="clear" onClick={() => setQuery("")}>
            清除
          </button>
        )}
      </div>

      {cloud.canManage && <button className="addButton" aria-label="＋ 新增产品" disabled={saving || !cloud.canWrite} onClick={() => { resetForm(); setOpen(true); }}>
        <DesignIcon name="add" /> 新增产品
      </button>}

      <section className="list">
        {filtered.length === 0 ? (
          <EmptyState title={query ? "没有找到符合的产品。" : "公司目录还没有产品"}>{query ? "试试产品编号、名称或标签。" : cloud.canManage ? "新增第一项产品，开始展示与报价。" : "产品准备好后，会显示在这里。"}</EmptyState>
        ) : (
          filtered.map((item) => (
            <article className="card" key={item.id} onClick={() => openProductDetail(item)}>
              <div className="thumb">
                {item.image ? (
                  <img src={item.image} alt={item.name} />
                ) : (
                  <div className="placeholder">NO PHOTO</div>
                )}
              </div>

              <div className="content">
                <div className="topline">
                  <button
                    type="button"
                    className="name productNameButton"
                    aria-label={`查看 ${item.name} 详情`}
                    aria-haspopup="dialog"
                    onClick={(e) => {
                      e.stopPropagation();
                      openProductDetail(item);
                    }}
                  >
                    {item.name}
                  </button>
                  <div className="price">RM {item.price}</div>
                </div>

                <div className="serial">产品编号：{item.serial}</div>
                {item.imageError && <p className="accountError">{item.imageError}</p>}

                {!!item.tags?.length && (
                  <div className="tags">
                    {item.tags.map((tag, i) => (
                      <span className="tag" key={`${tag}-${i}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {cloud.canManage && <div className="cardActions">
                  <button
                    type="button"
                    className="textButton"
                    disabled={saving || (cloud && !cloud.canWrite)}
                    aria-label={`编辑 ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      editItem(item);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="deleteButton"
                    disabled={saving || (cloud && !cloud.canWrite)}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteItem(item.id);
                    }}
                  >
                    删除
                  </button>
                </div>}
              </div>
            </article>
          ))
        )}
      </section>
      <FloatingAction className="quotationCartButton" count={quotationCount} disabled={!quotationReady} onClick={viewQuotation}>
        报价清单：{quotationCount} 件 查看 / 生成报价 →
      </FloatingAction>

      {selectedProduct && (
        <dialog
          ref={detailDialog}
          className="sheet productDialog"
          aria-labelledby="productDetailTitle"
          onClose={() => setSelectedProduct(null)}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const bounds = e.currentTarget.getBoundingClientRect();
            if (e.clientX < bounds.left || e.clientX > bounds.right ||
                e.clientY < bounds.top || e.clientY > bounds.bottom) {
              e.currentTarget.close();
            }
          }}
        >
          <div className="detailHeader">
            <span>产品详情</span>
            <button
              type="button"
              className="closeButton"
              aria-label="关闭产品详情"
              autoFocus
              onClick={() => detailDialog.current.close()}
            >
              ×
            </button>
          </div>

          {(shareCompany.name || shareCompany.logo) && <div className="detailCompany">
            {shareCompany.logo && <img src={shareCompany.logo} alt="公司 Logo" />}
            {shareCompany.name && <span>{shareCompany.name}</span>}
          </div>}

          <div className="detailImage">
            {selectedProduct.image ? (
              <img src={selectedProduct.image} alt={selectedProduct.name} />
            ) : (
              <div className="placeholder">NO PHOTO</div>
            )}
          </div>
          <h2 id="productDetailTitle">{selectedProduct.name}</h2>
          {selectedProduct.imageError && <p className="accountError" role="alert">{selectedProduct.imageError} 含照片卡片暂不可生成。</p>}
          <p className="detailCode">Product Code: {selectedProduct.serial}</p>
          {!!selectedProduct.tags?.length && (
            <div className="tags detailTags">
              {selectedProduct.tags.map((tag, i) => (
                <span className="tag" key={`${tag}-${i}`}>{tag}</span>
              ))}
            </div>
          )}
          <p className="detailPrice">RM {selectedProduct.price}</p>

          <div className="detailActions">
            <button
              type="button"
              className="whatsappButton"
              disabled={sharing || cardGenerating || !companyReady || !!selectedProduct.imageError}
              onClick={() => productCard ? shareProductCard() : setCardAttempt(value => value + 1)}
            >
              {sharing ? "正在打开分享…" : cardGenerating ? "正在准备产品卡片…" : productCard ? "分享卡片到 WhatsApp" : "重新生成产品卡片"}
            </button>
            <button
              type="button"
              className="saveButton"
              disabled={!quotationReady || quotation.busy}
              onClick={() => addToQuotation(selectedProduct)}
            >
              ＋ 加入报价清单
            </button>
          </div>
          {productCard && <button type="button" className="cardDownloadButton textButton"
            onClick={() => downloadFile(productCard)} disabled={sharing}>下载产品卡片</button>}
          <p className="detailMessage" role="status" aria-live="polite">{detailMessage}</p>
          {companyError && <p className="quotationError" role="alert">{companyError}</p>}
          {quotationCount > 0 && <button type="button" className="viewQuotationButton" onClick={viewQuotation}>
            查看报价清单（{quotationCount} 件） →
          </button>}
          {quotationError && <p className="quotationError" role="alert">{quotationError}</p>}
        </dialog>
      )}

      {open && (
        <Modal labelledBy="productFormTitle" locked={saving} onClose={closeForm}>
            <div className="sheetHeader">
              <div>
                <h2 id="productFormTitle">{editingId ? "编辑产品" : "新增产品"}</h2>
                <p>{editingId ? "修改产品资料后保存" : "填写产品资料后保存"}</p>
              </div>
              <button className="closeButton" aria-label="关闭产品表单" onClick={closeForm}>
                ×
              </button>
            </div>

            <form onSubmit={addItem}>
              <fieldset disabled={saving} className="productFields">
              {editingRecord?.imageError && <p className="accountError">{editingRecord.imageError} 只修改文字会保留云端照片路径；请上传新照片以修复。</p>}
              <label>
                产品编号 *
                <input
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="例如 P-003"
                  required
                />
              </label>

              <label>
                名称 *
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 Sample Product C"
                  required
                />
              </label>

              <label>
                标签
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="分类, 材质, 款式"
                />
                <small>多个标签使用英文逗号分开</small>
              </label>

              <label>
                价格 *
                <div className="priceInput">
                  <span>RM</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                  />
                </div>
              </label>

              <label>
                照片
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    onImageChange(file);
                  }}
                />
                <small>JPG、PNG、WebP 或 HEIC，最大 12MB。自动缩小图片并选择兼容格式；HEIC 需浏览器支持读取。</small>
              </label>

              {image && <img className="preview" src={image} alt="预览" />}
              {image && <button type="button" className="textButton" onClick={() => {
                imageUploadToken.current += 1;
                setImageLoading(false);
                setFormError("");
                setImage("");
              }}>移除照片</button>}
              {formError && <p className="quotationError" role="alert">{formError}</p>}

              <div className="formActions">
                <button
                  type="button"
                  className="cancelButton"
                  onClick={closeForm}
                >
                  取消
                </button>
                <button className="saveButton" type="submit" disabled={imageLoading || saving || (cloud && !cloud.canWrite)}>
                  {saving ? "正在保存到云端…" : imageLoading ? "正在转换图片…" : editingId ? "保存修改" : "保存产品"}
                </button>
              </div>
              </fieldset>
            </form>
        </Modal>
      )}
    </main>
  );
}
