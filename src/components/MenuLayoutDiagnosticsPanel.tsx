import { useEffect, useMemo, useState } from "react";
import {
  clearMenuLayoutDiagnosticHistory,
  getMenuLayoutPageRunId,
  loadMenuLayoutDiagnosticHistory,
  MENU_LAYOUT_DIAGNOSTICS_LIMIT,
  type MenuLayoutDiagnosticEvent,
  type StoredMenuLayoutDiagnostic,
} from "../accessibility/menuLayoutDiagnostics";

declare global {
  interface Window {
    __demoCoffeeMenuLayoutDiagnostics?: MenuLayoutDiagnosticEvent[];
  }
}

const panelEnabled = () => new URLSearchParams(window.location.search).get("menuLayoutDiagnostics") === "1";

export default function MenuLayoutDiagnosticsPanel() {
  const [visible, setVisible] = useState(panelEnabled);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<StoredMenuLayoutDiagnostic[]>(() => loadMenuLayoutDiagnosticHistory());
  const [copyMessage, setCopyMessage] = useState("");
  const [currentPageRunId, setCurrentPageRunId] = useState("");

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    setCurrentPageRunId(getMenuLayoutPageRunId());
    const onDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<MenuLayoutDiagnosticEvent>).detail;
      const record = detail as StoredMenuLayoutDiagnostic;
      setRecords((current) => [...current, record].slice(-MENU_LAYOUT_DIAGNOSTICS_LIMIT));
    };
    const onClear = () => setRecords([]);
    window.addEventListener("demo-coffee:menu-layout-diagnostic", onDiagnostic);
    window.addEventListener("demo-coffee:menu-layout-diagnostics-cleared", onClear);
    return () => {
      window.removeEventListener("demo-coffee:menu-layout-diagnostic", onDiagnostic);
      window.removeEventListener("demo-coffee:menu-layout-diagnostics-cleared", onClear);
    };
  }, []);

  const currentRecords = useMemo(
    () => records.filter((record) => record.pageRunId === currentPageRunId),
    [records, currentPageRunId],
  );
  const priorRecords = useMemo(
    () => records.filter((record) => record.pageRunId !== currentPageRunId),
    [records, currentPageRunId],
  );
  const summary = useMemo(() => {
    const latest = (phases: string[]) => [...records].reverse().find((record) => phases.includes(record.phase));
    const response = latest(["response_received"]);
    const plan = latest(["plan_validated", "plan_rejected"]);
    const dom = latest(["react_dom_committed"]);
    const sourceLabel = (source: unknown) =>
      source === "central" ? "중앙 응답" :
      source === "automatic_mock" || source === "mock" ? "개발 Mock" :
      typeof source === "string" ? source : "출처 기록 없음";
    return [
      ["중앙 요청", response ? `HTTP ${response.status}` : "응답 기록 없음"],
      ["계획 검증", plan?.phase === "plan_validated" ? `통과 · ${sourceLabel(plan.source)}` : plan ? `거부 · ${plan.reason ?? "검증 실패"}` : "기록 없음"],
      ["React 커밋", dom?.planState === "applied" ? "DOM 반영" : "적용 기록 없음"],
      ["실제 CSS", dom ? `${dom.computedColumnCount}열 · ${dom.aiColumns ? `계획 ${dom.aiColumns}열` : "계획 표식 없음"}` : "기록 없음"],
    ] as const;
  }, [records]);

  if (!import.meta.env.DEV || !visible) return null;

  const copyRecords = async () => {
    const payload = JSON.stringify({ currentPage: currentRecords, previousPage: priorRecords }, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setCopyMessage("진단 기록을 복사했습니다.");
        return;
      }
    } catch {
      // Try the browser's selection-based copy path below.
    }
    const field = document.createElement("textarea");
    field.value = payload;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    setCopyMessage(copied
      ? "진단 기록을 복사했습니다."
      : "복사할 수 없습니다. 브라우저 클립보드 권한을 확인해 주세요.");
  };

  const clearRecords = () => {
    clearMenuLayoutDiagnosticHistory();
    if (window.__demoCoffeeMenuLayoutDiagnostics) window.__demoCoffeeMenuLayoutDiagnostics.length = 0;
    setRecords([]);
    window.dispatchEvent(new CustomEvent("demo-coffee:menu-layout-diagnostics-cleared"));
    setCopyMessage("이 탭의 진단 기록을 지웠습니다.");
  };

  return (
    <div className="menu-layout-diagnostics">
      <button
        className="menu-layout-diagnostics-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="menu-layout-diagnostics-panel"
        onClick={() => setOpen((value) => !value)}
      >
        진단 {records.length ? `· ${records.length}` : ""}
      </button>
      {open && (
        <section className="menu-layout-diagnostics-panel" id="menu-layout-diagnostics-panel" aria-label="메뉴 자동 배치 진단">
          <header>
            <div>
              <strong>메뉴 배치 진단</strong>
              <span>Development 전용 · 저장은 현재 탭에만 유지</span>
            </div>
            <button type="button" aria-label="진단 패널 닫기" onClick={() => setOpen(false)}>닫기</button>
          </header>
          <dl>
            {summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <div className="menu-layout-diagnostics-actions">
            <button type="button" onClick={() => void copyRecords()}>기록 복사</button>
            <button type="button" onClick={clearRecords}>기록 초기화</button>
          </div>
          {copyMessage && <p role="status">{copyMessage}</p>}
          <div className="menu-layout-diagnostics-records">
            <h3>현재 페이지 실행 ({currentRecords.length})</h3>
            <ol>{currentRecords.slice(-12).map((record, index) => (
              <DiagnosticRow key={`${record.recordedAt}-${index}`} record={record} />
            ))}</ol>
            <h3>새로고침 이전 기록 ({priorRecords.length})</h3>
            <ol>{priorRecords.slice(-12).map((record, index) => (
              <DiagnosticRow key={`${record.recordedAt}-prior-${index}`} record={record} />
            ))}</ol>
          </div>
        </section>
      )}
    </div>
  );
}

function DiagnosticRow({ record }: { record: StoredMenuLayoutDiagnostic }) {
  const details = [
    record.source && `출처 ${record.source}`,
    record.status !== undefined && `HTTP ${record.status}`,
    record.allowedColumns && `허용 열 ${record.allowedColumns}`,
    record.columns !== undefined && `계획 ${record.columns}열`,
    record.cardLayout !== undefined && `카드 ${record.cardLayout ? "가로형" : "기본"}`,
    record.computedColumnCount !== undefined && `CSS ${record.computedColumnCount}열`,
    record.reason && `사유 ${record.reason}`,
  ].filter(Boolean).join(" · ");
  return <li><time>{new Date(record.recordedAt).toLocaleTimeString()}</time><strong>{record.phase}</strong>{details && <span>{details}</span>}</li>;
}
