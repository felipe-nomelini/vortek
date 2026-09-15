"use client";

import {
  CheckCircleOutlined,
  FileImageOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Image,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BVF_JOB_STATUS_PRESENTATION,
  parseBvfJobStatusPresentation,
  type BvfCreativeSections,
} from "@/lib/video-factory/ui-contracts";
import type { BvfJobStatus } from "@/lib/video-factory/contracts";
import styles from "./VideoFactoryStudio.module.css";

const { Paragraph, Text, Title } = Typography;

type Asset = {
  id: string;
  asset_type: string;
  persona_id?: string | null;
  produto_id?: string | null;
  reference_slot: "front" | "profile" | "full_body" | null;
  active: boolean;
  mime_type: string;
  width: number | null;
  height: number | null;
  checksum_sha256: string | null;
  metadata?: Record<string, unknown>;
  deactivated_at?: string | null;
  deactivation_reason?: string | null;
  created_at: string;
};

type StudioProduct = {
  canManage: boolean;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    category: string | null;
    description: string | null;
    active: boolean;
    stock: number;
    dimensions: {
      widthCm: number | null;
      heightCm: number | null;
      depthCm: number | null;
      weightGrams: number | null;
    };
    images: string[];
  };
  listings: Array<{
    itemId: string;
    title: string | null;
    status: string | null;
    price: number | null;
    sold: number;
    visits: number;
    quality: number | null;
    tip: string | null;
    permalink: string | null;
  }>;
  references: Asset[];
};

type Persona = {
  id: string;
  code: string;
  version: string;
  name: string;
  status: string;
  role: string | null;
  visual_description: string | null;
  personality: string | null;
  voice_description: string | null;
  accent: string | null;
  humor_style: string | null;
  allowed_categories: string[];
  references: Asset[];
};

type Family = {
  id: string;
  family_key: string;
  name: string;
  active: boolean;
  activeMemberCount: number;
};

type Job = Record<string, any> & {
  id: string;
  sku: string | null;
  family_key: string | null;
  video_type: "HUMAN_DEMO" | "CINEMATIC_PRODUCT" | "FAMILY_VIDEO";
  content_scope: "SKU" | "FAMILY";
  status: BvfJobStatus;
  currentBrief: Record<string, any> | null;
  canManage: boolean;
  generationGate?: {
    reviewReady: boolean;
    referencesReady: boolean;
    quoteReady: boolean;
    canAuthorize: boolean;
    blockers: string[];
  };
  availableActions: string[];
};

const EMPTY_SECTIONS: BvfCreativeSections = {
  hook: "",
  problem: "",
  solution: "",
  demonstration: "",
  humor: "",
  dialogue: "",
  onscreenText: "",
  closing: "",
};

const SLOT_LABELS = {
  front: "Frontal",
  profile: "Perfil",
  full_body: "Corpo inteiro",
} as const;

const VIDEO_TYPES = [
  { value: "HUMAN_DEMO", label: "Demonstração com pessoa" },
  { value: "CINEMATIC_PRODUCT", label: "Produto cinematográfico" },
  { value: "FAMILY_VIDEO", label: "Vídeo coringa de família" },
];

const SECTION_FIELDS: Array<{
  key: keyof BvfCreativeSections;
  label: string;
  rows: number;
}> = [
  { key: "hook", label: "Gancho", rows: 2 },
  { key: "problem", label: "Problema", rows: 2 },
  { key: "solution", label: "Solução", rows: 2 },
  { key: "demonstration", label: "Demonstração", rows: 3 },
  { key: "humor", label: "Humor", rows: 2 },
  { key: "dialogue", label: "Falas", rows: 3 },
  { key: "onscreenText", label: "Textos na tela", rows: 2 },
  { key: "closing", label: "Fechamento", rows: 2 },
];

const MASTER_CHECKLIST = [
  "Produto correto",
  "Escala correta",
  "Persona correta",
  "Mãos e objetos aceitáveis",
  "Texto correto",
  "Fala correta",
  "Nenhum claim inventado",
  "Variação compatível",
  "Branding aceitável",
  "Produto não deformado",
  "Qualidade comercial aceitável",
];

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Não foi possível concluir a operação.");
  }
  return payload;
}

function formatNumber(value: number | null, suffix = "") {
  return value == null
    ? "Não informado"
    : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value)}${suffix}`;
}

function formatMoney(value: number | null) {
  return value == null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function StatusTag({ status }: { status: unknown }) {
  const presentation = parseBvfJobStatusPresentation(status);
  const color = {
    default: "default",
    processing: "blue",
    success: "green",
    warning: "gold",
    error: "red",
  }[presentation.tone];
  return <Tag color={color}>{presentation.label}</Tag>;
}

function SignedAssetImage({ asset, alt }: { asset: Asset; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void fetch(`/api/video-factory/assets/${asset.id}/signed-url`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(responseJson)
      .then((payload) => setUrl(String(payload.signedUrl)))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [asset.id]);
  if (failed) return <div className={styles.imageFallback}>Preview indisponível</div>;
  if (!url) return <div className={styles.imageFallback}><Spin size="small" /></div>;
  return <Image className={styles.referenceImage} src={url} alt={alt} preview />;
}

function ReferenceCard({
  asset,
  label,
  canManage,
  selected,
  onSelect,
  onDeactivate,
}: {
  asset: Asset;
  label: string;
  canManage: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onDeactivate?: () => void;
}) {
  const source = String(asset.metadata?.source_kind ?? "referência BVF");
  return (
    <Card size="small" className={styles.referenceCard}>
      <SignedAssetImage asset={asset} alt={`${label} ${asset.active ? "ativa" : "inativa"}`} />
      <div className={styles.referenceMeta}>
        <strong>{label}</strong>
        <Text type="secondary">{source === "product_catalog" ? "Cadastro do produto" : source === "manual_upload" ? "Upload manual" : source}</Text>
        <Space wrap size={4}>
          <Tag>{asset.width} × {asset.height}px</Tag>
          <Tag color={asset.active ? "green" : "default"}>{asset.active ? "ATIVA" : "INATIVA"}</Tag>
        </Space>
        {onSelect && asset.active && (
          <Checkbox checked={selected} onChange={(event) => onSelect(event.target.checked)}>
            Usar no briefing
          </Checkbox>
        )}
        {canManage && asset.active && onDeactivate && (
          <Button danger size="small" onClick={onDeactivate}>Desativar</Button>
        )}
      </div>
    </Card>
  );
}

export default function VideoFactoryStudio() {
  const [messageApi, messageContext] = message.useMessage();
  const [modalApi, modalContext] = Modal.useModal();
  const [tab, setTab] = useState("studio");
  const [sku, setSku] = useState("VTK000115");
  const [product, setProduct] = useState<StudioProduct | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaCanManage, setPersonaCanManage] = useState(false);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState<string>();
  const [familyProducts, setFamilyProducts] = useState<StudioProduct[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [videoType, setVideoType] = useState<Job["video_type"]>("HUMAN_DEMO");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState("");
  const [sections, setSections] = useState<BvfCreativeSections>(EMPTY_SECTIONS);
  const [claimDecisions, setClaimDecisions] = useState<Record<number, "verified" | "forbidden">>({});
  const [additionalForbidden, setAdditionalForbidden] = useState("");
  const [scaleStatus, setScaleStatus] = useState<"defined" | "unavailable" | undefined>();
  const [scaleReason, setScaleReason] = useState("");
  const [unsafeAcknowledgements, setUnsafeAcknowledgements] = useState<string[]>([]);
  const [selectedProductRefs, setSelectedProductRefs] = useState<string[]>([]);
  const [selectedPersonaRefs, setSelectedPersonaRefs] = useState<string[]>([]);

  const rafa = personas.find((persona) => persona.code === "RAFA" && persona.status === "active") ?? null;
  const canManage = Boolean(product?.canManage || job?.canManage || personaCanManage);

  const loadPersonas = useCallback(async () => {
    const payload = await responseJson(await fetch("/api/video-factory/personas", { cache: "no-store" }));
    setPersonas(payload.data ?? []);
    setPersonaCanManage(payload.canManage === true);
    return payload;
  }, []);

  const loadFamilies = useCallback(async () => {
    const payload = await responseJson(await fetch("/api/video-factory/families?page=1&pageSize=100&active=true", { cache: "no-store" }));
    setFamilies(payload.data ?? []);
  }, []);

  const loadJobs = useCallback(async () => {
    const payload = await responseJson(await fetch("/api/video-factory/jobs?page=1&pageSize=50", { cache: "no-store" }));
    setJobs(payload.data ?? []);
  }, []);

  useEffect(() => {
    void Promise.all([loadPersonas(), loadFamilies(), loadJobs()]).catch(() =>
      messageApi.error("Não foi possível carregar a Video Factory."),
    );
  }, [loadFamilies, loadJobs, loadPersonas, messageApi]);

  const loadProduct = useCallback(async (requestedSku = sku, preserveJob = false) => {
    setLoading(true);
    try {
      const normalized = requestedSku.trim().toUpperCase();
      const payload = await responseJson(await fetch(`/api/video-factory/studio/products/by-sku?sku=${encodeURIComponent(normalized)}`, { cache: "no-store" }));
      setSku(normalized);
      setProduct(payload);
      if (!preserveJob) {
        setJob(null);
        setSelectedProductRefs([]);
        setSelectedPersonaRefs([]);
        setClaimDecisions({});
        setUnsafeAcknowledgements([]);
      }
    } catch (error) {
      setProduct(null);
      messageApi.error(error instanceof Error ? error.message : "SKU não encontrado.");
    } finally {
      setLoading(false);
    }
  }, [messageApi, sku]);

  const loadFamilyProducts = useCallback(async (selectedFamilyId: string) => {
    const family = await responseJson(await fetch(`/api/video-factory/families/${selectedFamilyId}`, { cache: "no-store" }));
    const memberSkus = (family.members ?? [])
      .filter((member: any) => !member.removed_at)
      .map((member: any) => String(member.sku));
    const members = await Promise.all(memberSkus.map(async (memberSku: string) =>
      responseJson(await fetch(`/api/video-factory/studio/products/by-sku?sku=${encodeURIComponent(memberSku)}`, { cache: "no-store" })),
    ));
    setFamilyProducts(members);
    return members;
  }, []);

  const loadJob = useCallback(async (jobId: string) => {
    const payload = await responseJson(await fetch(`/api/video-factory/jobs/${jobId}`, { cache: "no-store" }));
    setJob(payload);
    const creative = payload.currentBrief?.creative_brief ?? {};
    setDirection(String(creative.direction ?? ""));
    setSections({ ...EMPTY_SECTIONS, ...(creative.sections ?? {}) });
    const review = creative.review ?? {};
    setClaimDecisions(Object.fromEntries((review.claimDecisions ?? []).map((item: any) => [Number(item.index), item.decision])));
    setAdditionalForbidden((review.additionalForbiddenClaims ?? []).map((item: any) => item.text).join("\n"));
    setScaleStatus(review.scale?.status);
    setScaleReason(String(review.scale?.reason ?? ""));
    setUnsafeAcknowledgements(review.variationUnsafeAcknowledgements ?? []);
    const references = Array.isArray(creative.references) ? creative.references : [];
    setSelectedProductRefs(references.filter((item: any) => item.assetType === "product_reference").map((item: any) => item.assetId));
    setSelectedPersonaRefs(references.filter((item: any) => item.assetType === "persona_reference").map((item: any) => item.assetId));
    setVideoType(payload.video_type);
    if (payload.family_id) {
      setFamilyId(payload.family_id);
      await loadFamilyProducts(payload.family_id);
      setProduct(null);
    } else if (payload.sku) {
      setFamilyProducts([]);
      await loadProduct(payload.sku, true);
    }
    setTab("studio");
  }, [loadFamilyProducts, loadProduct]);

  async function mutate(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      messageApi.success(success);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Operação recusada.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadReference(file: File, target: { type: "product"; id: string } | { type: "persona"; id: string; slot: string }) {
    await mutate(async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("requestId", crypto.randomUUID());
      form.set("targetType", target.type);
      if (target.type === "product") form.set("productId", target.id);
      else { form.set("personaId", target.id); form.set("slot", target.slot); }
      await responseJson(await fetch("/api/video-factory/assets/references/upload", { method: "POST", body: form }));
      if (target.type === "product") await loadProduct(undefined, Boolean(job));
      else await loadPersonas();
    }, "Referência registrada e conferida.");
  }

  async function importProductImage(sourceUrl: string) {
    if (!product) return;
    await mutate(async () => {
      await responseJson(await fetch("/api/video-factory/assets/references/import-product-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), productId: product.product.id, sourceUrl }),
      }));
      await loadProduct(undefined, Boolean(job));
    }, "Imagem copiada para o Storage privado.");
  }

  async function deactivateReference(asset: Asset) {
    await mutate(async () => {
      await responseJson(await fetch(`/api/video-factory/assets/${asset.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Desativada na biblioteca BVF" }),
      }));
      await loadPersonas();
      if (job) await loadJob(job.id);
      else if (product) await loadProduct();
    }, "Referência desativada; o histórico foi preservado.");
  }

  async function createJob() {
    const target = videoType === "FAMILY_VIDEO"
      ? familyId ? { kind: "family", familyId } : null
      : product ? { kind: "product", productId: product.product.id } : null;
    if (!target) return messageApi.warning(videoType === "FAMILY_VIDEO" ? "Selecione uma família existente." : "Carregue um SKU.");
    await mutate(async () => {
      const payload = await responseJson(await fetch("/api/video-factory/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), target, videoType }),
      }));
      await Promise.all([loadJob(payload.job.id), loadJobs()]);
    }, "Job criado e briefing factual preparado.");
  }

  const factual = job?.currentBrief?.factual_snapshot ?? null;
  const verifiedClaims = useMemo(
    () => Array.isArray(factual?.verifiedClaims) ? factual.verifiedClaims : [],
    [factual],
  );
  const forbiddenClaims = useMemo(
    () => Array.isArray(factual?.forbiddenClaims) ? factual.forbiddenClaims : [],
    [factual],
  );
  const variationSafe = useMemo(
    () => Array.isArray(factual?.variationSafe) ? factual.variationSafe : [],
    [factual],
  );
  const unsafe = useMemo(
    () => Array.isArray(factual?.variationUnsafe) ? factual.variationUnsafe : [],
    [factual],
  );
  const dimensions = factual?.physicalDimensions ?? null;
  const referenceProducts = job?.content_scope === "FAMILY" ? familyProducts : product ? [product] : [];
  const allProductReferences = referenceProducts.flatMap((member) =>
    member.references.filter((asset) => asset.active).map((asset) => ({ asset, sku: member.product.sku })),
  );
  const activePersonaReferences = useMemo(
    () => rafa?.references.filter((asset) => asset.active) ?? [],
    [rafa],
  );

  async function saveReview() {
    if (!job?.currentBrief?.id || !scaleStatus) return messageApi.warning("Conclua a decisão de escala.");
    const expectedBriefVersionId = job.currentBrief.id;
    await mutate(async () => {
      const payload = await responseJson(await fetch(`/api/video-factory/jobs/${job.id}/brief-review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedBriefVersionId,
          direction,
          sections,
          claimDecisions: Object.entries(claimDecisions).map(([index, decision]) => ({ index: Number(index), decision })),
          additionalForbiddenClaims: additionalForbidden.split("\n").map((line) => line.trim()).filter(Boolean),
          scaleReview: scaleStatus === "defined" ? { status: "defined" } : { status: "unavailable", reason: scaleReason },
          selectedProductReferenceIds: selectedProductRefs,
          selectedPersonaReferenceIds: selectedPersonaRefs,
          variationUnsafeAcknowledgements: unsafeAcknowledgements,
        }),
      }));
      setJob(payload.job);
      await loadJobs();
    }, "Revisão factual salva em nova versão imutável.");
  }

  function authorizeGeneration() {
    if (!job?.generationGate?.canAuthorize || !job.currentBrief?.id) return;
    const briefVersionId = job.currentBrief.id;
    modalApi.confirm({
      title: "Autorizar briefing e custo desta geração?",
      content: `${job.generation_provider} · ${job.generation_model} · ${job.estimated_cost_currency} ${job.estimated_cost}`,
      okText: "Autorizar geração paga",
      async onOk() {
        await responseJson(await fetch(`/api/video-factory/jobs/${job.id}/authorize-generation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            briefVersionId,
            provider: job.generation_provider,
            model: job.generation_model,
            estimatedCost: job.estimated_cost,
            currency: job.estimated_cost_currency,
          }),
        }));
        await Promise.all([loadJob(job.id), loadJobs()]);
        messageApi.success("Briefing e custo autorizados. Nenhuma geração foi iniciada.");
      },
    });
  }

  const reviewBlockers = useMemo(() => {
    if (!job) return [];
    const blockers: string[] = [];
    if (!direction.trim()) blockers.push("Preencha a direção geral do briefing.");
    if (verifiedClaims.some((_: any, index: number) => !claimDecisions[index])) blockers.push("Revise todos os claims.");
    if (!scaleStatus) blockers.push("Defina ou marque a escala como indisponível.");
    if (scaleStatus === "unavailable" && scaleReason.trim().length < 3) blockers.push("Explique por que a escala está indisponível.");
    if (unsafe.some((item: any) => !unsafeAcknowledgements.includes(String(item.key)))) blockers.push("Confirme todos os atributos inseguros da família.");
    return blockers;
  }, [claimDecisions, direction, job, scaleReason, scaleStatus, unsafe, unsafeAcknowledgements, verifiedClaims]);

  const referenceBlockers = useMemo(() => {
    if (!job) return [];
    const blockers: string[] = [];
    if (job.content_scope === "FAMILY") {
      const membersWithoutReference = familyProducts.filter((member) =>
        !member.references.some((asset) => asset.active && selectedProductRefs.includes(asset.id)),
      );
      if (familyProducts.length === 0 || membersWithoutReference.length > 0) {
        blockers.push("Selecione ao menos uma referência ativa de cada produto da família.");
      }
    } else if (selectedProductRefs.length === 0) blockers.push("Selecione ao menos uma referência ativa do produto.");
    if (job.video_type === "HUMAN_DEMO" && new Set(activePersonaReferences.map((asset) => asset.reference_slot)).size < 3) blockers.push("A RAFA precisa das três referências canônicas ativas.");
    if (job.video_type === "HUMAN_DEMO" && selectedPersonaRefs.length < 3) blockers.push("Selecione as três referências canônicas da RAFA.");
    return blockers;
  }, [activePersonaReferences, familyProducts, job, selectedPersonaRefs, selectedProductRefs]);

  const gateBlockers = [...reviewBlockers, ...referenceBlockers];

  const personaTab = (
    <Space direction="vertical" size={16} className={styles.fullWidth}>
      {personas.length === 0 ? <Empty description="Nenhuma persona cadastrada" /> : personas.map((persona) => (
        <Card key={persona.id} title={<Space><UserOutlined /><span>{persona.code} — {persona.role}</span></Space>} extra={<Space><Tag>{persona.version}</Tag><Tag color={persona.status === "active" ? "green" : "default"}>{persona.status.toUpperCase()}</Tag></Space>}>
          <Descriptions size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Identidade">{persona.visual_description || "Não informada"}</Descriptions.Item>
            <Descriptions.Item label="Personalidade">{persona.personality || "Não informada"}</Descriptions.Item>
            <Descriptions.Item label="Voz">{persona.voice_description || "Não informada"}</Descriptions.Item>
            <Descriptions.Item label="Sotaque e humor">{[persona.accent, persona.humor_style].filter(Boolean).join(" · ") || "Não informado"}</Descriptions.Item>
            <Descriptions.Item label="Território" span={2}>{persona.allowed_categories?.join(" · ") || "Não informado"}</Descriptions.Item>
          </Descriptions>
          <Title level={4}>Referências canônicas</Title>
          <div className={styles.referenceGrid}>
            {(Object.keys(SLOT_LABELS) as Array<keyof typeof SLOT_LABELS>).map((slot) => {
              const assets = persona.references.filter((asset) => asset.reference_slot === slot);
              const active = assets.find((asset) => asset.active);
              return <Card size="small" key={slot} title={SLOT_LABELS[slot]}>
                {active ? <ReferenceCard asset={active} label={SLOT_LABELS[slot]} canManage={canManage} onDeactivate={() => void deactivateReference(active)} /> : <Alert type="warning" showIcon message="Referência ausente" />}
                {canManage && <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false} beforeUpload={(file) => { void uploadReference(file, { type: "persona", id: persona.id, slot }); return Upload.LIST_IGNORE; }}>
                  <Button className={styles.uploadButton} icon={<UploadOutlined />} loading={busy}>{active ? "Substituir" : "Enviar imagem"}</Button>
                </Upload>}
              </Card>;
            })}
          </div>
          {persona.references.some((asset) => !asset.active) && <details className={styles.historyDetails}><summary>Histórico de referências inativas</summary><List dataSource={persona.references.filter((asset) => !asset.active)} renderItem={(asset) => <List.Item><Text>{asset.reference_slot ? SLOT_LABELS[asset.reference_slot] : "Referência"} · {new Date(asset.created_at).toLocaleString("pt-BR")} · {asset.deactivation_reason}</Text></List.Item>} /></details>}
        </Card>
      ))}
    </Space>
  );

  const studioTab = (
    <Space direction="vertical" size={16} className={styles.fullWidth}>
      <Card className={styles.searchCard}>
        <Space direction="vertical" className={styles.fullWidth} size={12}>
          <div>
            <Text className={styles.eyebrow}>BENTEVI VIDEO FACTORY</Text>
            <Title level={2} className={styles.title}>Estúdio de vídeo</Title>
            <Paragraph type="secondary">Dados reais, revisão factual e aprovação humana. Nenhum provider está ativo nesta etapa.</Paragraph>
          </div>
          <Space.Compact className={styles.skuSearch}>
            <Input aria-label="SKU do produto" value={sku} onChange={(event) => setSku(event.target.value)} onPressEnter={() => void loadProduct()} placeholder="VTK000115" />
            <Button type="primary" loading={loading} onClick={() => void loadProduct()}>Carregar</Button>
          </Space.Compact>
        </Space>
      </Card>

      {product && <Card title={<Space><FileImageOutlined /><span>{product.product.sku} — {product.product.name}</span></Space>} extra={<Tag color={product.product.active ? "green" : "orange"}>{product.product.active ? "ATIVO" : "INATIVO"}</Tag>}>
        {!product.product.active && <Alert className={styles.inlineAlert} type="warning" showIcon message="Produto inativo" description="A BVF apenas exibe este estado e nunca altera produtos.ativo." />}
        <Descriptions column={{ xs: 1, md: 2, xl: 3 }} size="small">
          <Descriptions.Item label="Marca">{product.product.brand || "Não informada"}</Descriptions.Item>
          <Descriptions.Item label="Categoria">{product.product.category || "Não informada"}</Descriptions.Item>
          <Descriptions.Item label="Estoque cadastrado">{product.product.stock}</Descriptions.Item>
          <Descriptions.Item label="Largura">{formatNumber(product.product.dimensions.widthCm, " cm")}</Descriptions.Item>
          <Descriptions.Item label="Altura">{formatNumber(product.product.dimensions.heightCm, " cm")}</Descriptions.Item>
          <Descriptions.Item label="Profundidade">{formatNumber(product.product.dimensions.depthCm, " cm")}</Descriptions.Item>
          <Descriptions.Item label="Peso">{formatNumber(product.product.dimensions.weightGrams, " g")}</Descriptions.Item>
          <Descriptions.Item label="Scale anchor" span={2}>{product.product.dimensions.widthCm && product.product.dimensions.heightCm && product.product.dimensions.depthCm ? `L ${formatNumber(product.product.dimensions.widthCm)} × A ${formatNumber(product.product.dimensions.heightCm)} × P ${formatNumber(product.product.dimensions.depthCm)} cm` : <Tag color="orange">ESCALA NÃO DEFINIDA</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Descrição" span={3}>{product.product.description || "Não informada"}</Descriptions.Item>
        </Descriptions>
        <Title level={4}>Anúncios relacionados</Title>
        {product.listings.length ? <Table size="small" rowKey="itemId" pagination={false} scroll={{ x: 760 }} dataSource={product.listings} columns={[
          { title: "Anúncio", dataIndex: "itemId" },
          { title: "Status", dataIndex: "status", render: (value) => value || "Não informado" },
          { title: "Preço ML", dataIndex: "price", render: formatMoney },
          { title: "Vendidos", dataIndex: "sold" },
          { title: "Visitas", dataIndex: "visits" },
          { title: "Qualidade", dataIndex: "quality", render: (value) => value == null ? "—" : `${value}/100` },
          { title: "Dica ML", dataIndex: "tip", ellipsis: true, render: (value) => value || "Sem dica" },
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sem anúncio relacionado" />}
        <Title level={4}>Imagens reais do cadastro</Title>
        {product.product.images.length ? <div className={styles.gallery}>{product.product.images.map((url, index) => <div className={styles.catalogImage} key={url}><Image src={url} alt={`${product.product.sku}, imagem do cadastro ${index + 1}`} /><Text>IMAGEM DO CADASTRO {index + 1}</Text>{product.canManage && <Button size="small" disabled={!product.product.active} loading={busy} onClick={() => void importProductImage(url)}>Usar como referência</Button>}</div>)}</div> : <Alert type="warning" showIcon message="Produto sem imagens" description="A revisão factual pode continuar, mas a geração permanecerá bloqueada." />}
        <Space className={styles.sectionHeading} wrap><Title level={4}>Referências privadas do produto</Title>{product.canManage && <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false} disabled={!product.product.active} beforeUpload={(file) => { void uploadReference(file, { type: "product", id: product.product.id }); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />} disabled={!product.product.active}>Enviar referência</Button></Upload>}</Space>
        {product.references.length ? <div className={styles.referenceGrid}>{product.references.map((asset, index) => <ReferenceCard key={asset.id} asset={asset} label={`REFERÊNCIA PRODUTO ${index + 1}`} canManage={product.canManage} selected={selectedProductRefs.includes(asset.id)} onSelect={(checked) => setSelectedProductRefs((current) => checked ? [...new Set([...current, asset.id])] : current.filter((id) => id !== asset.id))} onDeactivate={() => void deactivateReference(asset)} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma referência importada" />}
      </Card>}

      <Card title="Configuração criativa">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}><Text>Tipo</Text><Select className={styles.fullWidth} value={videoType} options={VIDEO_TYPES} onChange={(value) => { setVideoType(value); setJob(null); if (value !== "FAMILY_VIDEO") setFamilyProducts([]); }} /></Col>
          <Col xs={24} md={12}><Text>Escopo</Text><Input value={videoType === "FAMILY_VIDEO" ? "Família / Coringa" : "SKU específico"} readOnly /></Col>
          <Col xs={24} md={12}><Text>Persona</Text><Input value={videoType === "HUMAN_DEMO" ? (rafa ? "RAFA — Apresentador técnico" : "RAFA indisponível") : "Não se aplica"} readOnly /></Col>
          {videoType === "FAMILY_VIDEO" && <Col xs={24} md={12}><Text>Família existente</Text><Select className={styles.fullWidth} value={familyId} onChange={(value) => { setFamilyId(value); setJob(null); setSelectedProductRefs([]); void loadFamilyProducts(value).catch((error) => messageApi.error(error instanceof Error ? error.message : "Não foi possível carregar a família.")); }} placeholder="Selecione uma família" options={families.map((family) => ({ value: family.id, label: `${family.family_key} — ${family.name} (${family.activeMemberCount})` }))} /></Col>}
        </Row>
        {videoType === "FAMILY_VIDEO" && families.length === 0 && <Alert className={styles.inlineAlert} type="warning" showIcon message="Nenhuma família ativa cadastrada" description="A BVF não inventará uma família para liberar o gate." />}
        <Button type="primary" className={styles.primaryAction} disabled={!canManage || (videoType === "FAMILY_VIDEO" ? !familyId : !product?.product.active)} loading={busy} onClick={() => void createJob()}>Criar briefing factual</Button>
      </Card>

      {job && job.currentBrief && <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Space direction="vertical" size={16} className={styles.fullWidth}>
            <Card title="Revisão factual" extra={<StatusTag status={job.status} />}>
              <Alert type="info" showIcon message="Criatividade pode variar. Fatos não." description="Todo claim de origem conhecida deve ser confirmado ou bloqueado antes da autorização." />
              <Title level={4}>Claims verificados</Title>
              {verifiedClaims.length ? <List dataSource={verifiedClaims} renderItem={(claim: any, index) => <List.Item className={styles.claimRow}><div><Text>{claim.text}</Text><br /><Text type="secondary">Origem: {claim.source?.kind || "registrada"} · {claim.source?.reference || "sem referência textual"}</Text></div><Radio.Group aria-label={`Decisão do claim ${index + 1}`} value={claimDecisions[index]} onChange={(event) => setClaimDecisions((current) => ({ ...current, [index]: event.target.value }))} options={[{ value: "verified", label: "Confirmar" }, { value: "forbidden", label: "Bloquear" }]} /></List.Item>} /> : <Alert type="warning" showIcon message="Nenhum claim verificado estruturado" />}
              <Title level={4}>Claims proibidos ou não comprovados</Title>
              {forbiddenClaims.length ? <List size="small" dataSource={forbiddenClaims} renderItem={(claim: any) => <List.Item><Text>{claim.text ?? String(claim)}</Text></List.Item>} /> : <Text type="secondary">Nenhum claim proibido registrado no snapshot atual.</Text>}
              <Text>Claims adicionais a proibir — um por linha</Text>
              <Input.TextArea rows={3} value={additionalForbidden} onChange={(event) => setAdditionalForbidden(event.target.value)} placeholder="Não cria fato; apenas impede o uso do texto." />
              <Title level={4}>Dimensões e escala</Title>
              <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="Largura">{dimensions?.widthCm ? `${formatNumber(dimensions.widthCm.value)} cm` : "Ausente"}</Descriptions.Item>
                <Descriptions.Item label="Altura">{dimensions?.heightCm ? `${formatNumber(dimensions.heightCm.value)} cm` : "Ausente"}</Descriptions.Item>
                <Descriptions.Item label="Profundidade">{dimensions?.depthCm ? `${formatNumber(dimensions.depthCm.value)} cm` : "Ausente"}</Descriptions.Item>
                <Descriptions.Item label="Peso">{dimensions?.weightGrams ? `${formatNumber(dimensions.weightGrams.value)} g` : "Ausente"}</Descriptions.Item>
                <Descriptions.Item label="Scale anchor" span={2}>{factual.scaleAnchor || "ESCALA NÃO DEFINIDA"}</Descriptions.Item>
              </Descriptions>
              <Radio.Group value={scaleStatus} onChange={(event) => setScaleStatus(event.target.value)} options={[{ value: "defined", label: "Escala conferida" }, { value: "unavailable", label: "Escala indisponível" }]} />
              {scaleStatus === "unavailable" && <Input value={scaleReason} onChange={(event) => setScaleReason(event.target.value)} placeholder="Motivo obrigatório" />}
              {job.content_scope === "FAMILY" && <><Title level={4}>Variation safety</Title><Text strong>Seguro para família</Text>{variationSafe.length ? <div className={styles.safeList}>{variationSafe.map((item: any) => <Tag color="green" key={item.key ?? item.label}>{item.label ?? item.key}</Tag>)}</div> : <Text type="secondary">Nenhum atributo invariável foi confirmado.</Text>}{unsafe.length > 0 ? <><Alert className={styles.inlineAlert} type="warning" showIcon message="Atributos não seguros para vídeo coringa" description="Eles permanecem bloqueados em fala, tela, fechamento e claims." /><Checkbox.Group className={styles.unsafeList} value={unsafeAcknowledgements} onChange={(values) => setUnsafeAcknowledgements(values.map(String))}>{unsafe.map((item: any) => <Checkbox key={item.key} value={item.key}><strong>{item.label}</strong> — {item.reason}</Checkbox>)}</Checkbox.Group></> : <Text type="secondary">Nenhum atributo inseguro registrado.</Text>}</>}
            </Card>
            <Card title="Referências selecionadas">
              <Title level={5}>Produto</Title>
              {allProductReferences.length ? <Checkbox.Group className={styles.checkboxList} value={selectedProductRefs} onChange={(values) => setSelectedProductRefs(values.map(String))}>{allProductReferences.map(({ asset, sku: referenceSku }, index) => <Checkbox key={asset.id} value={asset.id}>{referenceSku} · referência {index + 1} · {asset.width}×{asset.height}px</Checkbox>)}</Checkbox.Group> : <Alert type="warning" message="Nenhuma referência ativa do produto" />}
              {job.video_type === "HUMAN_DEMO" && <><Title level={5}>RAFA</Title>{activePersonaReferences.length ? <Checkbox.Group className={styles.checkboxList} value={selectedPersonaRefs} onChange={(values) => setSelectedPersonaRefs(values.map(String))}>{activePersonaReferences.map((asset) => <Checkbox key={asset.id} value={asset.id}>{asset.reference_slot ? SLOT_LABELS[asset.reference_slot] : "Referência canônica"}</Checkbox>)}</Checkbox.Group> : <Alert type="warning" message="Biblioteca RAFA vazia" />}</>}
            </Card>
            <Card title="Briefing criativo">
              <Text>Direção geral</Text><Input.TextArea rows={3} value={direction} onChange={(event) => setDirection(event.target.value)} />
              <div className={styles.briefGrid}>{SECTION_FIELDS.map((field) => <label key={field.key}><Text>{field.label}</Text><Input.TextArea rows={field.rows} value={sections[field.key]} onChange={(event) => setSections((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}</div>
              <Button type="primary" icon={<CheckCircleOutlined />} disabled={!job.canManage || reviewBlockers.length > 0} loading={busy} onClick={() => void saveReview()}>Salvar revisão imutável</Button>
            </Card>
          </Space>
        </Col>
        <Col xs={24} xl={8}>
          <div className={styles.gateRail}>
            <Card title="Pendências do briefing">
              {gateBlockers.length ? <List size="small" dataSource={gateBlockers} renderItem={(blocker) => <List.Item><Text type="warning">• {blocker}</Text></List.Item>} /> : <Alert type="success" showIcon message="Revisão pronta para salvar" />}
            </Card>
            <Card title="Gate #1 — briefing e custo">
              {job.generationGate?.reviewReady ? <Alert type="success" showIcon message="Revisão factual versionada" /> : <Alert type="warning" showIcon message="Revisão factual pendente" />}
              {!job.generationGate?.quoteReady && <Alert className={styles.inlineAlert} type="info" showIcon message="Provider ainda não configurado" description="A cotação real será fornecida por BVF-PROVIDER-01. Nenhum custo ou prompt foi inventado." />}
              <Button type="primary" block disabled={!job.generationGate?.canAuthorize} onClick={authorizeGeneration}>Autorizar briefing e custo</Button>
            </Card>
            <Card title="Área de produção"><Alert type={job.status === "approved_for_generation" && job.generationGate?.referencesReady ? "success" : "info"} showIcon message={job.status === "approved_for_generation" ? (job.generationGate?.referencesReady ? "Pronto para geração" : "Referências alteradas — nova revisão necessária") : "Aguardando Gate #1"} description="Provider/worker não existem nesta etapa. Nenhuma geração será simulada." /></Card>
            <Card title="Gate #2 — master"><Alert type="warning" showIcon message="Aguardando geração" description="Aprovação indisponível sem master real e validação técnica." /><div className={styles.masterChecklist}>{MASTER_CHECKLIST.map((item) => <Checkbox key={item} disabled>{item}</Checkbox>)}</div><Button block disabled>Aprovar master</Button></Card>
            <Card title="Histórico do job"><List size="small" dataSource={[{ label: `Criação · ${job.created_by ?? "autor não disponível"}`, at: job.created_at }, ...(job.briefVersions ?? []).map((version: any) => ({ label: `Briefing v${version.version} · ${version.engine_version} · ${version.created_by}`, at: version.created_at })), ...(job.generation_approved_at ? [{ label: `Gate #1 · ${job.generation_approved_by}`, at: job.generation_approved_at }] : []), ...(job.attempts ?? []).map((attempt: any) => ({ label: `Tentativa ${attempt.attempt_number} · ${attempt.status}`, at: attempt.created_at })), ...(job.rejected_at ? [{ label: `Master rejeitado · ${job.rejected_by}${job.rejection_reason ? ` · ${job.rejection_reason}` : ""}`, at: job.rejected_at }] : []), ...(job.approved_at ? [{ label: `Master aprovado · ${job.approved_by}`, at: job.approved_at }] : [])]} renderItem={(event: any) => <List.Item><div><Text>{event.label}</Text><br /><Text type="secondary">{new Date(event.at).toLocaleString("pt-BR")}</Text></div></List.Item>} /></Card>
          </div>
        </Col>
      </Row>}
    </Space>
  );

  const historyTab = <Card title="Jobs BVF" extra={<Button icon={<ReloadOutlined />} onClick={() => void loadJobs()}>Atualizar</Button>}><Table rowKey="id" dataSource={jobs} pagination={{ pageSize: 20 }} onRow={(record) => ({ onClick: () => void loadJob(record.id), className: styles.clickableRow })} columns={[
    { title: "Criado", dataIndex: "created_at", render: (value) => new Date(value).toLocaleString("pt-BR") },
    { title: "Alvo", render: (_, record) => record.sku || record.family_key || "—" },
    { title: "Tipo", dataIndex: "video_type" },
    { title: "Estado", dataIndex: "status", render: (value) => <StatusTag status={value} /> },
  ]} />{Object.keys(BVF_JOB_STATUS_PRESENTATION).length === 16 && <Text type="secondary">Os 16 estados do domínio são apresentados sem agrupamento.</Text>}</Card>;

  return <main className={styles.page}>
    {messageContext}{modalContext}
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: "studio", label: <Space><VideoCameraOutlined />Estúdio</Space>, children: studioTab },
      { key: "personas", label: <Space><UserOutlined />Personas</Space>, children: personaTab },
      { key: "history", label: <Space><HistoryOutlined />Histórico</Space>, children: historyTab },
    ]} />
    <Alert icon={<SafetyCertificateOutlined />} showIcon type="info" message="Domínio isolado" description="A Video Factory lê produto e anúncio; todas as escritas desta tela permanecem nas estruturas video_* e no bucket privado video-factory." />
  </main>;
}
