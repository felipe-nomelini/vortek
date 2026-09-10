"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Alert, Button, Spin } from "antd";
import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  MutedOutlined,
  ReloadOutlined,
  SoundFilled,
} from "@ant-design/icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  TvCelebrations,
  TvChannelFooter,
  TvGoalsPanel,
  TvMetricStrip,
  TvProjectionPanel,
  TvRecentQuestions,
  TvRecentSales,
} from "@/components/tv/TvDashboardPanels";
import { formatCurrency } from "@/lib/format";
import {
  dynamicTvGoals,
  mergeTvLiveMetrics,
  pickTvSaleSoundIndex,
  tvConnectionState,
  TV_FULL_REFRESH_MS,
  TV_LIVE_REFRESH_MS,
  type TvLiveMetrics,
  type TvMetrics,
  type TvOrderSummary,
  type TvQuestionSummary,
} from "@/lib/tv/dashboard";
import styles from "./tv.module.css";

const SALE_SOUND_SOURCES = [
  "/sounds/dreigue.mp3",
  "/sounds/para-de-ser-doida.m4a",
  "/sounds/rupaul1.m4a",
  "/sounds/viaaaadoooo.m4a",
] as const;
const QUESTION_SOUND_SRC = "/sounds/ala-nem-vou-ler-ines-brasil.mp3";

type SaleCelebration = {
  id: number;
  orderNumber: number;
  customer: string;
  total: number;
};

type QuestionCelebration = TvQuestionSummary & { celebrationId: number };

const emptyToday: TvMetrics["today"] = {
  orders: 0,
  revenue: 0,
  profit: 0,
  averageTicket: 0,
  statusCounts: {},
};

function formatClock(value: number | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function TvDashboardPage() {
  const [data, setData] = useState<TvMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullError, setFullError] = useState<string | null>(null);
  const [lastLiveSuccessAt, setLastLiveSuccessAt] = useState<number | null>(null);
  const [healthClock, setHealthClock] = useState(() => Date.now());
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [saleCelebration, setSaleCelebration] = useState<SaleCelebration | null>(null);
  const [questionCelebration, setQuestionCelebration] = useState<QuestionCelebration | null>(null);
  const [questionQueue, setQuestionQueue] = useState<TvQuestionSummary[]>([]);

  const shellRef = useRef<HTMLElement | null>(null);
  const saleAudioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabledRef = useRef(true);
  const fullRefreshInFlightRef = useRef(false);
  const liveRefreshInFlightRef = useRef(false);
  const lastOrderIdRef = useRef<string | null>(null);
  const playedOrderIdsRef = useRef<Set<string>>(new Set());
  const seenQuestionIdsRef = useRef<Set<string>>(new Set());
  const saleTimerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playSound = useCallback((kind: "sale" | "question") => {
    if (!soundEnabledRef.current) return;
    if (kind === "question") {
      const questionAudio = questionAudioRef.current;
      if (!questionAudio) return;
      questionAudio.currentTime = 0;
      questionAudio.play().catch(() => undefined);
      return;
    }

    const soundIndex = pickTvSaleSoundIndex(SALE_SOUND_SOURCES.length, Math.random());
    if (soundIndex === null) return;
    saleAudioRefs.current.forEach((saleAudio) => {
      saleAudio?.pause();
      if (saleAudio) saleAudio.currentTime = 0;
    });
    saleAudioRefs.current[soundIndex]?.play().catch(() => undefined);
  }, []);

  const handleNewestOrder = useCallback((orders: TvOrderSummary[] | undefined) => {
    const newest = orders?.[0];
    const previousId = lastOrderIdRef.current;
    if (!previousId) {
      lastOrderIdRef.current = newest?.id || null;
      if (newest?.id) playedOrderIdsRef.current.add(newest.id);
      return;
    }
    if (!newest?.id || newest.id === previousId) return;
    lastOrderIdRef.current = newest.id;
    if (playedOrderIdsRef.current.has(newest.id)) return;
    playedOrderIdsRef.current.add(newest.id);
    setSaleCelebration({
      id: Date.now(),
      orderNumber: newest.number,
      customer: newest.customer,
      total: newest.total,
    });
    playSound("sale");
    if (saleTimerRef.current) window.clearTimeout(saleTimerRef.current);
    saleTimerRef.current = window.setTimeout(() => {
      setSaleCelebration(null);
      saleTimerRef.current = null;
    }, 7_000);
  }, [playSound]);

  const handleNewestQuestions = useCallback((questions: TvQuestionSummary[] | undefined) => {
    if (!questions?.length) return;
    if (seenQuestionIdsRef.current.size === 0) {
      questions.forEach((question) => seenQuestionIdsRef.current.add(question.id));
      return;
    }
    const incoming = questions
      .filter((question) => !seenQuestionIdsRef.current.has(question.id))
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
    if (!incoming.length) return;
    incoming.forEach((question) => seenQuestionIdsRef.current.add(question.id));
    setQuestionQueue((current) => [...current, ...incoming]);
  }, []);

  useEffect(() => {
    if (questionCelebration || questionQueue.length === 0) return;
    const [next, ...remaining] = questionQueue;
    setQuestionQueue(remaining);
    setQuestionCelebration({ ...next, celebrationId: Date.now() });
    playSound("question");
    questionTimerRef.current = window.setTimeout(() => {
      setQuestionCelebration(null);
      questionTimerRef.current = null;
    }, 7_000);
  }, [playSound, questionCelebration, questionQueue]);

  const loadMetrics = useCallback(async () => {
    if (fullRefreshInFlightRef.current) return false;
    fullRefreshInFlightRef.current = true;
    try {
      const response = await fetch("/api/tv/metrics", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.erro || json?.error || "Erro ao carregar o painel completo");
      }
      const next = json as TvMetrics;
      setData(next);
      setFullError(null);
      handleNewestOrder(next.recentOrders);
      handleNewestQuestions(next.recentQuestions);
      return true;
    } catch (error: unknown) {
      setFullError(error instanceof Error ? error.message : "Erro ao carregar o painel completo");
      return false;
    } finally {
      fullRefreshInFlightRef.current = false;
      setLoading(false);
    }
  }, [handleNewestOrder, handleNewestQuestions]);

  const loadLiveMetrics = useCallback(async () => {
    if (liveRefreshInFlightRef.current) return false;
    liveRefreshInFlightRef.current = true;
    try {
      const response = await fetch("/api/tv/live", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.erro || json?.error || "Atualização ao vivo indisponível");
      const live = json as TvLiveMetrics;
      const receivedAt = Date.now();
      setData((current) => mergeTvLiveMetrics(current, live));
      setLastLiveSuccessAt(receivedAt);
      setHealthClock(receivedAt);
      handleNewestOrder(live.recentOrders);
      return true;
    } catch {
      setHealthClock(Date.now());
      return false;
    } finally {
      liveRefreshInFlightRef.current = false;
    }
  }, [handleNewestOrder]);

  const refreshAll = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await Promise.all([loadMetrics(), loadLiveMetrics()]);
    } finally {
      setManualRefreshing(false);
    }
  }, [loadLiveMetrics, loadMetrics]);

  useEffect(() => {
    void loadMetrics();
    void loadLiveMetrics();
    const liveInterval = window.setInterval(() => void loadLiveMetrics(), TV_LIVE_REFRESH_MS);
    const fullInterval = window.setInterval(() => void loadMetrics(), TV_FULL_REFRESH_MS);
    const healthInterval = window.setInterval(() => setHealthClock(Date.now()), TV_LIVE_REFRESH_MS);
    return () => {
      window.clearInterval(liveInterval);
      window.clearInterval(fullInterval);
      window.clearInterval(healthInterval);
      if (saleTimerRef.current) window.clearTimeout(saleTimerRef.current);
      if (questionTimerRef.current) window.clearTimeout(questionTimerRef.current);
    };
  }, [loadLiveMetrics, loadMetrics]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    shellRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const connection = tvConnectionState(lastLiveSuccessAt, healthClock);
  const healthLabel = {
    loading: "Conectando",
    live: "Atualização normal",
    delayed: "Atualização atrasada",
    offline: "Atualização interrompida",
  }[connection];
  const healthClass = {
    loading: "",
    live: styles.healthLive,
    delayed: styles.healthDelayed,
    offline: styles.healthOffline,
  }[connection];

  const goals = useMemo(
    () => dynamicTvGoals(data?.goals, data?.today || emptyToday),
    [data?.goals, data?.today],
  );
  const hourly = useMemo(() => data?.hourlySales || [], [data?.hourlySales]);
  const bestHour = useMemo(
    () => hourly.reduce(
      (best, current) => current.revenue > best.revenue ? current : best,
      { hour: 0, label: "—", revenue: 0, orders: 0 },
    ),
    [hourly],
  );

  const warning = fullError
    ? `O painel completo não atualizou: ${fullError}. Os últimos dados válidos foram preservados.`
    : connection === "offline"
      ? "A atualização ao vivo está interrompida. Os últimos dados válidos continuam na tela."
      : null;

  return (
    <main ref={shellRef} className={styles.tvShell}>
      {SALE_SOUND_SOURCES.map((source, index) => (
        <audio
          key={source}
          ref={(audio) => {
            saleAudioRefs.current[index] = audio;
          }}
          src={source}
          preload="auto"
        />
      ))}
      <audio ref={questionAudioRef} src={QUESTION_SOUND_SRC} preload="auto" />

      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <Image
            src="/branding/bentevi/bentevi-wordmark.png"
            alt="Bentevi"
            width={176}
            height={37}
            priority
            style={{ width: 176, height: "auto" }}
          />
          <div className={styles.brandStatus}>
            <strong><i className={styles.liveDot} aria-hidden="true" /> TV ao vivo</strong>
            <small>{formatClock(healthClock)} · São Paulo</small>
          </div>
        </div>

        <div className={`${styles.health} ${healthClass}`} role="status" aria-live="polite">
          <i className={styles.healthDot} aria-hidden="true" />
          <div className={styles.healthCopy}>
            <strong>{healthLabel}</strong>
            <small>última leitura {formatClock(data?.generatedAt || null)}</small>
          </div>
        </div>

        <div className={styles.actions}>
          <Button
            type={soundEnabled ? "primary" : "default"}
            icon={soundEnabled ? <SoundFilled /> : <MutedOutlined />}
            onClick={() => {
              setSoundEnabled((current) => !current);
              saleAudioRefs.current.forEach((saleAudio) => saleAudio?.load());
              questionAudioRef.current?.load();
            }}
          >
            Som {soundEnabled ? "ligado" : "desligado"}
          </Button>
          <Button icon={<ReloadOutlined />} loading={manualRefreshing} onClick={() => void refreshAll()}>
            Atualizar
          </Button>
          <Button
            icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={toggleFullscreen}
          >
            {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          </Button>
        </div>
      </header>

      {warning ? <Alert className={styles.warningBanner} type="warning" showIcon message={warning} /> : null}

      {loading && !data ? (
        <div className={styles.loading}><Spin size="large" /></div>
      ) : !data ? (
        <div className={styles.initialError}>
          <strong>Não foi possível carregar a TV ao vivo.</strong>
          <span>{fullError || "Verifique a conexão e tente novamente."}</span>
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => void refreshAll()} loading={manualRefreshing}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <TvMetricStrip data={data} />

          <section className={styles.insightGrid} aria-label="Metas e tendências">
            <TvGoalsPanel data={data} goals={goals} />
            <section className={`${styles.panel} ${styles.chartPanel}`} aria-labelledby="tv-hourly-title">
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>Distribuição de hoje</span>
                  <h2 id="tv-hourly-title">Vendas por hora</h2>
                </div>
                <span className={styles.panelHint}>melhor faixa {bestHour.label}</span>
              </header>
              <div className={styles.chart}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} barCategoryGap={4} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#34313a" vertical={false} />
                    <XAxis dataKey="label" stroke="#8c8c8c" tickLine={false} axisLine={false} interval={2} fontSize={9} />
                    <Tooltip
                      cursor={{ fill: "rgba(255, 189, 14, .08)" }}
                      contentStyle={{ background: "#141316", border: "1px solid #34313a", borderRadius: 8, color: "#f7f7f8" }}
                      formatter={(value, name) => [name === "revenue" ? formatCurrency(Number(value)) : value, name === "revenue" ? "Faturamento" : "Vendas"]}
                    />
                    <Bar dataKey="revenue" radius={[5, 5, 0, 0]}>
                      {hourly.map((entry) => (
                        <Cell key={entry.hour} fill={entry.hour === bestHour.hour && entry.revenue > 0 ? "#ffbd0e" : "#70683f"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <TvProjectionPanel data={data} />
          </section>

          <section className={styles.activityGrid} aria-label="Atividade recente">
            <TvRecentSales orders={data.recentOrders} />
            <TvRecentQuestions questions={data.recentQuestions} />
          </section>

          <TvChannelFooter ads={data.ads} />
        </>
      )}

      <TvCelebrations sale={saleCelebration} question={questionCelebration} />
    </main>
  );
}
