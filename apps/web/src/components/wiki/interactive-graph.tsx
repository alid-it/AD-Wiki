'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  ExternalLink,
  Expand,
  FileText,
  Folder,
  Maximize2,
  Network,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  ShieldCheck,
  Tags,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type GraphNode = {
  id: string;
  title: string;
  slug: string;
  type: 'root' | 'wiki' | 'category' | 'folder' | 'page' | 'note-root' | 'note-category' | 'note' | 'standard-root' | 'standard-category' | 'standard';
  mcpVisible: boolean;
  group: string;
};

export type GraphLink = {
  sourceId: string;
  targetId: string;
  kind: 'structure' | 'wiki' | 'standard';
};

export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };
type Point = { x: number; y: number };
type View = { x: number; y: number; scale: number };

const WIDTH = 1180;
const HEIGHT = 760;
const GROUP_COLORS = [
  'var(--color-accent-400)',
  'var(--color-brand-400)',
  'var(--color-success-500)',
  'var(--color-warning-500)',
  'var(--color-danger-500)',
  'var(--color-accent-600)',
];
const TYPE_COLORS: Record<GraphNode['type'], string> = {
  root: 'var(--color-brand-600)',
  wiki: 'var(--color-success-600)',
  category: 'var(--color-accent-600)',
  folder: 'var(--color-warning-600)',
  page: 'var(--color-success-600)',
  'note-root': 'var(--color-accent-700)',
  'note-category': 'var(--color-danger-500)',
  note: 'var(--color-accent-500)',
  'standard-root': 'var(--color-danger-600)',
  'standard-category': 'var(--color-warning-600)',
  standard: 'var(--color-danger-500)',
};

const isContentNode = (node: GraphNode) => node.type === 'page' || node.type === 'note' || node.type === 'standard';

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

function groupColor(group: string) {
  return GROUP_COLORS[hash(group) % GROUP_COLORS.length];
}

function initialPositions(graph: GraphData): Record<string, Point> {
  const groups = [...new Set(graph.nodes.filter(isContentNode).map((node) => node.group))];
  const centers = new Map<string, Point>();
  groups.forEach((group, index) => {
    const angle = (index / Math.max(groups.length, 1)) * Math.PI * 2 - Math.PI / 2;
    centers.set(group, {
      x: WIDTH / 2 + Math.cos(angle) * Math.min(300, 110 + groups.length * 24),
      y: HEIGHT / 2 + Math.sin(angle) * Math.min(230, 80 + groups.length * 18),
    });
  });

  const counts = new Map<string, number>();
  return Object.fromEntries(graph.nodes.map((node, index) => {
    if (node.type === 'root') return [node.id, { x: WIDTH / 2, y: HEIGHT / 2 }];
    if (node.type === 'wiki') return [node.id, { x: WIDTH / 2 - 150, y: HEIGHT / 2 }];
    if (node.type === 'note-root') return [node.id, { x: WIDTH / 2 + 150, y: HEIGHT / 2 }];
    if (node.type === 'standard-root') return [node.id, { x: WIDTH / 2, y: HEIGHT / 2 + 150 }];
    const center = centers.get(node.group) ?? { x: WIDTH / 2, y: HEIGHT / 2 };
    const groupIndex = counts.get(node.group) ?? 0;
    counts.set(node.group, groupIndex + 1);
    const angle = groupIndex * 2.399 + index * 0.07;
    const radius = 28 + Math.sqrt(groupIndex + 1) * 38;
    return [node.id, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }];
  }));
}

export function InteractiveGraph({ graph, mode }: { graph: GraphData; mode: 'wiki' | 'mcp' }) {
  const t = useTranslations('graph');
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const positionsRef = useRef<Record<string, Point>>({});
  const velocitiesRef = useRef<Record<string, Point>>({});
  const dragRef = useRef<{ id: string; pointerId: number; lastPoint: Point } | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragPaintRef = useRef<number | null>(null);
  const resumeSimulationRef = useRef<(() => void) | null>(null);
  const layoutOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showStructure, setShowStructure] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [hideOrphans, setHideOrphans] = useState(false);
  const [focusDepth, setFocusDepth] = useState(0);
  const [repulsion, setRepulsion] = useState(100);
  const [linkDistance, setLinkDistance] = useState(145);
  const [nodeSize, setNodeSize] = useState(100);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => setShowStructure(true), [mode]);

  const groups = useMemo(() => [...new Set(graph.nodes.filter(isContentNode).map((node) => node.group))].sort(), [graph]);
  const wikiDegree = useMemo(() => {
    const degree = new Map<string, number>();
    graph.nodes.forEach((node) => degree.set(node.id, 0));
    graph.links.filter((link) => link.kind === 'wiki').forEach((link) => {
      degree.set(link.sourceId, (degree.get(link.sourceId) ?? 0) + 1);
      degree.set(link.targetId, (degree.get(link.targetId) ?? 0) + 1);
    });
    return degree;
  }, [graph]);

  const focusTarget = focusDepth > 0 ? selected : null;
  const displayGraph = useMemo<GraphData>(() => {
    let nodes = graph.nodes.filter((node) => showStructure || isContentNode(node));
    if (hideOrphans) nodes = nodes.filter((node) => node.type !== 'page' || (wikiDegree.get(node.id) ?? 0) > 0);

    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (normalizedSearch) {
      const matching = new Set(nodes.filter((node) => `${node.title} ${node.slug} ${node.group}`.toLocaleLowerCase().includes(normalizedSearch)).map((node) => node.id));
      const contextual = new Set(matching);
      graph.links.forEach((link) => {
        if (matching.has(link.sourceId)) contextual.add(link.targetId);
        if (matching.has(link.targetId)) contextual.add(link.sourceId);
      });
      nodes = nodes.filter((node) => contextual.has(node.id));
    }

    if (focusTarget) {
      const visible = new Set([focusTarget]);
      for (let depth = 0; depth < focusDepth; depth += 1) {
        const frontier = new Set(visible);
        graph.links.forEach((link) => {
          if (frontier.has(link.sourceId)) visible.add(link.targetId);
          if (frontier.has(link.targetId)) visible.add(link.sourceId);
        });
      }
      nodes = nodes.filter((node) => visible.has(node.id));
    }

    const ids = new Set(nodes.map((node) => node.id));
    const links = graph.links.filter((link) => (showStructure || link.kind !== 'structure') && ids.has(link.sourceId) && ids.has(link.targetId));
    return { nodes, links };
  }, [focusDepth, focusTarget, graph, hideOrphans, search, showStructure, wikiDegree]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    displayGraph.nodes.forEach((node) => map.set(node.id, new Set()));
    displayGraph.links.forEach((link) => {
      map.get(link.sourceId)?.add(link.targetId);
      map.get(link.targetId)?.add(link.sourceId);
    });
    return map;
  }, [displayGraph]);
  const activeId = hovered ?? selected;
  const activeConnections = activeId ? adjacency.get(activeId) ?? new Set<string>() : null;
  const selectedNode = selected ? graph.nodes.find((node) => node.id === selected) ?? null : null;

  useEffect(() => {
    const next = initialPositions(displayGraph);
    positionsRef.current = next;
    velocitiesRef.current = Object.fromEntries(displayGraph.nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    layoutOffsetRef.current = { x: 0, y: 0 };
    setPositions(next);
    setView({ x: 0, y: 0, scale: 1 });

    const groupNames = [...new Set(displayGraph.nodes.map((node) => node.group))];
    const groupCenters = new Map<string, Point>();
    groupNames.forEach((group, index) => {
      const angle = (index / Math.max(groupNames.length, 1)) * Math.PI * 2 - Math.PI / 2;
      groupCenters.set(group, { x: WIDTH / 2 + Math.cos(angle) * 255, y: HEIGHT / 2 + Math.sin(angle) * 190 });
    });

    let tick = 0;
    // Obsidian-Feeling: Die Simulation läuft mit einer Energie (alpha), die
    // nach dem Start langsam abklingt, aber nie ganz auf null fällt. So bleibt
    // der Graph auch im Ruhezustand leise in Bewegung ("atmet").
    let alpha = 1;
    const alphaMin = 0.02;
    const alphaDecay = 0.98;
    const simulate = () => {
      const drag = dragRef.current;
      const draggingRoot = drag ? displayGraph.nodes.find((node) => node.id === drag.id)?.type === 'root' : false;
      // Beim Ziehen des Wurzelknotens verschiebt sich das gesamte Layout –
      // die Simulation pausiert dann, um nicht dagegen zu arbeiten.
      if (draggingRoot) {
        frameRef.current = requestAnimationFrame(simulate);
        return;
      }
      // Ein gezogener Knoten wird an den Zeiger geheftet; die Nachbarn folgen
      // ihm elastisch weiter – daraus entsteht das lebendige Ziehen wie in Obsidian.
      const pinnedId = drag ? drag.id : null;
      const slow = alpha <= alphaMin + 0.0001 && !pinnedId;
      // Im Ruhezustand nur noch jeden 4. Frame rechnen: spart CPU, hält aber Leben.
      if (slow && tick % 4 !== 0) {
        tick += 1;
        frameRef.current = requestAnimationFrame(simulate);
        return;
      }
      const energy = pinnedId ? Math.max(alpha, 0.5) : Math.max(alpha, alphaMin);
      const points = positionsRef.current;
      const velocities = velocitiesRef.current;
      const nodes = displayGraph.nodes;

      for (let first = 0; first < nodes.length; first += 1) {
        const a = nodes[first];
        for (let second = first + 1; second < nodes.length; second += 1) {
          const b = nodes[second];
          const dx = points[b.id].x - points[a.id].x;
          const dy = points[b.id].y - points[a.id].y;
          const squared = Math.max(dx * dx + dy * dy, 225);
          const distance = Math.sqrt(squared);
          const force = Math.min(2.2, (3400 * repulsion / 100) / squared) * energy;
          velocities[a.id].x -= (dx / distance) * force;
          velocities[a.id].y -= (dy / distance) * force;
          velocities[b.id].x += (dx / distance) * force;
          velocities[b.id].y += (dy / distance) * force;
        }
      }

      displayGraph.links.forEach((link) => {
        const source = points[link.sourceId];
        const target = points[link.targetId];
        if (!source || !target) return;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const desired = link.kind === 'structure' ? linkDistance * 0.82 : linkDistance;
        const strength = link.kind === 'structure' ? 0.004 : 0.007;
        const force = (distance - desired) * strength * energy;
        velocities[link.sourceId].x += (dx / distance) * force;
        velocities[link.sourceId].y += (dy / distance) * force;
        velocities[link.targetId].x -= (dx / distance) * force;
        velocities[link.targetId].y -= (dy / distance) * force;
      });

      nodes.forEach((node) => {
        const point = points[node.id];
        const velocity = velocities[node.id];
        // Gezogener Knoten bleibt fixiert – nur seine Nachbarn reagieren.
        if (node.id === pinnedId) { velocity.x = 0; velocity.y = 0; return; }
        const baseTarget = node.type === 'root'
          ? { x: WIDTH / 2, y: HEIGHT / 2 }
          : node.type === 'wiki'
            ? { x: WIDTH / 2 - 180, y: HEIGHT / 2 }
            : node.type === 'note-root'
              ? { x: WIDTH / 2 + 180, y: HEIGHT / 2 }
              : node.type === 'standard-root'
                ? { x: WIDTH / 2, y: HEIGHT / 2 + 180 }
              : groupCenters.get(node.group) ?? { x: WIDTH / 2, y: HEIGHT / 2 };
        const target = {
          x: baseTarget.x + layoutOffsetRef.current.x,
          y: baseTarget.y + layoutOffsetRef.current.y,
        };
        const gravity = node.type === 'root' ? 0.02 : node.type === 'wiki' || node.type === 'note-root' || node.type === 'standard-root' ? 0.008 : 0.0024;
        velocity.x += (target.x - point.x) * gravity * energy;
        velocity.y += (target.y - point.y) * gravity * energy;
        velocity.x *= 0.88;
        velocity.y *= 0.88;
        point.x = Math.max(28, Math.min(WIDTH - 28, point.x + velocity.x));
        point.y = Math.max(28, Math.min(HEIGHT - 28, point.y + velocity.y));
      });

      tick += 1;
      if (!pinnedId) alpha = Math.max(alpha * alphaDecay, alphaMin);
      if (!slow || tick % 2 === 0) setPositions({ ...points });
      frameRef.current = requestAnimationFrame(simulate);
    };
    // Jede Interaktion "heizt" die Simulation wieder auf, damit sie weich nachläuft.
    resumeSimulationRef.current = () => {
      alpha = 0.75;
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(simulate);
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) frameRef.current = requestAnimationFrame(simulate);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (dragPaintRef.current !== null) cancelAnimationFrame(dragPaintRef.current);
      frameRef.current = null;
      dragPaintRef.current = null;
      resumeSimulationRef.current = null;
    };
  }, [displayGraph, layoutVersion, linkDistance, repulsion]);

  const graphPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    const svgY = ((clientY - rect.top) / rect.height) * HEIGHT;
    return { x: (svgX - view.x) / view.scale, y: (svgY - view.y) / view.scale };
  }, [view]);

  function startNodeDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    event.stopPropagation();
    dragRef.current = { id, pointerId: event.pointerId, lastPoint: graphPoint(event.clientX, event.clientY) };
    event.currentTarget.setPointerCapture(event.pointerId);
    resumeSimulationRef.current?.();
    setSelected(id);
  }

  function moveNode(event: ReactPointerEvent<SVGGElement>, id: string) {
    const drag = dragRef.current;
    if (drag?.id !== id || drag.pointerId !== event.pointerId) return;
    const nextPoint = graphPoint(event.clientX, event.clientY);
    const node = displayGraph.nodes.find((item) => item.id === id);
    if (node?.type === 'root') {
      const dx = nextPoint.x - drag.lastPoint.x;
      const dy = nextPoint.y - drag.lastPoint.y;
      Object.entries(positionsRef.current).forEach(([nodeId, point]) => {
        point.x += dx;
        point.y += dy;
        velocitiesRef.current[nodeId] = { x: 0, y: 0 };
      });
      layoutOffsetRef.current.x += dx;
      layoutOffsetRef.current.y += dy;
      drag.lastPoint = nextPoint;
    } else {
      positionsRef.current[id] = nextPoint;
      velocitiesRef.current[id] = { x: 0, y: 0 };
    }
    // Pointer-Events kÃ¶nnen deutlich hÃ¤ufiger als der Bildschirm feuern.
    // Maximal ein React-Render pro Animation-Frame verhindert Ruckeln.
    if (dragPaintRef.current === null) {
      dragPaintRef.current = requestAnimationFrame(() => {
        setPositions({ ...positionsRef.current });
        dragPaintRef.current = null;
      });
    }
  }

  function endNodeDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    if (dragRef.current?.id !== id) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    resumeSimulationRef.current?.();
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - pan.x) / rect.width) * WIDTH;
    const dy = ((event.clientY - pan.y) / rect.height) * HEIGHT;
    panRef.current = { ...pan, x: event.clientX, y: event.clientY };
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function zoomTo(nextScale: number) {
    setView((current) => {
      const scale = Math.max(0.45, Math.min(3, nextScale));
      return {
        scale,
        x: WIDTH / 2 - (WIDTH / 2 - current.x) * (scale / current.scale),
        y: HEIGHT / 2 - (HEIGHT / 2 - current.y) * (scale / current.scale),
      };
    });
  }

  // Wie in Obsidian: Das Scrollrad zoomt auf den Punkt unter dem Mauszeiger.
  function zoomToPoint(factor: number, clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * WIDTH;
    const py = ((clientY - rect.top) / rect.height) * HEIGHT;
    setView((current) => {
      const scale = Math.max(0.45, Math.min(3, current.scale * factor));
      const ratio = scale / current.scale;
      return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    zoomToPoint(event.deltaY > 0 ? 0.9 : 1.1, event.clientX, event.clientY);
  }

  return (
    <div ref={rootRef} className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => setControlsOpen((current) => !current)} className="graph-icon-button" aria-label={controlsOpen ? t('hideControls') : t('showControls')} title={controlsOpen ? t('hideControls') : t('showControls')}>{controlsOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}</button>
          <span className="truncate text-xs text-muted">{t('visibleStats', { nodes: displayGraph.nodes.length, links: displayGraph.links.length })}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => zoomTo(view.scale * 0.85)} className="graph-icon-button" aria-label={t('zoomOut')} title={t('zoomOut')}><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={() => zoomTo(view.scale * 1.15)} className="graph-icon-button" aria-label={t('zoomIn')} title={t('zoomIn')}><ZoomIn className="h-4 w-4" /></button>
          <button type="button" onClick={() => setView({ x: 0, y: 0, scale: 1 })} className="graph-icon-button" aria-label={t('resetView')} title={t('resetView')}><Maximize2 className="h-4 w-4" /></button>
          <button type="button" onClick={() => void rootRef.current?.requestFullscreen?.()} className="graph-icon-button" aria-label={t('fullscreen')} title={t('fullscreen')}><Expand className="h-4 w-4" /></button>
        </div>
      </div>

      <div className={`grid ${controlsOpen ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : ''}`}>
        {controlsOpen && (
          <aside className="border-b border-border bg-surface p-4 lg:border-b-0 lg:border-r">
            <label className="relative block">
              <span className="sr-only">{t('searchLabel')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchPlaceholder')} className="min-h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20" />
            </label>

            <ControlSection title={t('filters')}>
              <GraphSwitch label={t('showStructure')} checked={showStructure} onChange={setShowStructure} />
              <GraphSwitch label={t('showLabels')} checked={showLabels} onChange={setShowLabels} />
              <GraphSwitch label={t('hideOrphans')} checked={hideOrphans} onChange={setHideOrphans} />
              <label className="block text-xs font-medium text-muted">
                {t('focusDepth')}
                <select value={focusDepth} onChange={(event) => setFocusDepth(Number(event.target.value))} disabled={!selected} className="mt-1 min-h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50">
                  <option value={0}>{t('focusAll')}</option>
                  <option value={1}>{t('focusOne')}</option>
                  <option value={2}>{t('focusTwo')}</option>
                  <option value={3}>{t('focusThree')}</option>
                </select>
              </label>
            </ControlSection>

            <ControlSection title={t('forces')}>
              <GraphRange label={t('repulsion')} value={repulsion} min={45} max={190} onChange={setRepulsion} />
              <GraphRange label={t('linkDistance')} value={linkDistance} min={80} max={260} onChange={setLinkDistance} />
              <GraphRange label={t('nodeSize')} value={nodeSize} min={70} max={170} onChange={setNodeSize} />
              <button type="button" onClick={() => setLayoutVersion((current) => current + 1)} className="mt-1 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-background cursor-pointer"><RotateCcw className="h-3.5 w-3.5" />{t('restartLayout')}</button>
            </ControlSection>

            <ControlSection title={t('groups')}>
              <div className="space-y-2">
                {groups.map((group) => <div key={group} className="flex items-center gap-2 text-xs text-muted"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: groupColor(group) }} /><span className="truncate">{group}</span></div>)}
              </div>
            </ControlSection>

            <ControlSection title={t('nodeTypes')}>
              <div className="space-y-2">
                {(['root', 'wiki', 'category', 'folder', 'page', 'note-root', 'note-category', 'note', 'standard-root', 'standard-category', 'standard'] as const).map((type) => <div key={type} className="flex items-center gap-2 text-xs text-muted"><span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ backgroundColor: TYPE_COLORS[type] }}><NodeGlyph type={type} size={13} /></span><span>{t(`node_${type}`)}</span></div>)}
              </div>
            </ControlSection>
          </aside>
        )}

        <div className="relative min-w-0 bg-background/60">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[560px] w-full touch-none select-none sm:h-[680px] lg:h-[760px]"
            role="img"
            aria-label={t('ariaLabel')}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onWheel={handleWheel}
          >
            <defs>
              <pattern id="knowledge-grid" width="42" height="42" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" className="fill-border" /></pattern>
            </defs>
            <rect width={WIDTH} height={HEIGHT} fill="url(#knowledge-grid)" className="pointer-events-none" />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              {displayGraph.links.map((link, index) => {
                const source = positions[link.sourceId];
                const target = positions[link.targetId];
                if (!source || !target) return null;
                const emphasized = !activeId || link.sourceId === activeId || link.targetId === activeId;
                return <line key={`${link.kind}-${link.sourceId}-${link.targetId}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`transition-opacity duration-200 ${link.kind === 'wiki' ? 'stroke-accent-500' : link.kind === 'standard' ? 'stroke-danger-500' : 'stroke-muted'} ${emphasized ? (link.kind === 'structure' ? 'opacity-65' : 'opacity-100') : 'opacity-20'}`} strokeWidth={link.kind === 'wiki' ? 3 : link.kind === 'standard' ? 3.5 : 1.75} strokeLinecap="round" />;
              })}

              {displayGraph.nodes.map((node) => {
                const point = positions[node.id];
                if (!point) return null;
                const connected = !activeConnections || node.id === activeId || activeConnections.has(node.id);
                const highlightedBySearch = !search.trim() || `${node.title} ${node.slug} ${node.group}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
                const selectedNode = selected === node.id;
                const radiusBase = node.type === 'root' ? 18 : node.type === 'wiki' || node.type === 'note-root' || node.type === 'standard-root' ? 16 : node.type === 'category' || node.type === 'note-category' || node.type === 'standard-category' ? 15 : node.type === 'folder' ? 14 : 12;
                // Obsidian-typisch: Knoten mit mehr Verbindungen werden größer.
                const degree = adjacency.get(node.id)?.size ?? 0;
                const radius = (radiusBase + Math.min(9, Math.sqrt(degree) * 2.4)) * nodeSize / 100;
                const nodeActive = hovered === node.id || selectedNode;
                const labelVisible = showLabels || selectedNode || hovered === node.id;
                const typeColor = TYPE_COLORS[node.type];
                return (
                  <g
                    key={node.id}
                    transform={`translate(${point.x} ${point.y})`}
                    role={isContentNode(node) ? 'link' : 'button'}
                    aria-label={`${node.title}, ${t(`node_${node.type}`)}`}
                    tabIndex={0}
                    onPointerDown={(event) => startNodeDrag(event, node.id)}
                    onPointerMove={(event) => moveNode(event, node.id)}
                    onPointerUp={(event) => endNodeDrag(event, node.id)}
                    onPointerCancel={(event) => endNodeDrag(event, node.id)}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelected(node.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(node.id); } }}
                    className={`cursor-grab outline-none transition-opacity duration-200 active:cursor-grabbing ${connected && highlightedBySearch ? 'opacity-100' : 'opacity-20'}`}
                  >
                    <g style={{ transform: nodeActive ? 'scale(1.3)' : 'scale(1)' }} className="transition-transform duration-200 ease-out motion-reduce:transition-none">
                      {isContentNode(node) && <circle r={radius + 3.5} fill="none" stroke={groupColor(node.group)} strokeWidth="1.5" opacity="0.8" />}
                      {selectedNode && <circle r={radius + 8} fill="none" stroke={typeColor} strokeWidth="2" opacity="0.5" className="animate-pulse motion-reduce:animate-none" />}
                      <circle r={radius} fill={typeColor} className="stroke-surface" strokeWidth={selectedNode ? 3 : 1.5} />
                      <NodeGlyph type={node.type} size={Math.max(9, radius * 1.15)} centered />
                      {node.mcpVisible && <circle cx={radius * 0.75} cy={-radius * 0.75} r={Math.max(2.5, radius * 0.36)} className="fill-brand-500 stroke-surface" strokeWidth="1.5" />}
                    </g>
                    {labelVisible && <text x={radius + 6} dy="4" className="pointer-events-none fill-foreground text-[11px] font-medium transition-opacity duration-200">{node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title}</text>}
                  </g>
                );
              })}
            </g>
          </svg>

          {displayGraph.nodes.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">{t('noFilterResults')}</div>}
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-xs text-muted backdrop-blur-sm">{t('interactionHint')}</p>
          {selectedNode && (
            <div className="absolute bottom-3 right-3 flex max-w-[calc(100%-1.5rem)] items-center gap-3 rounded-lg border border-border bg-surface/95 px-3 py-2 backdrop-blur-sm">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: groupColor(selectedNode.group) }} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{selectedNode.title}</p><p className="text-xs text-muted">{selectedNode.group} · {t('connectionCount', { count: adjacency.get(selectedNode.id)?.size ?? 0 })}</p></div>
              {selectedNode.type === 'page' && <Link href={`/wiki/${selectedNode.slug}`} className="graph-icon-button shrink-0" aria-label={t('openPage')} title={t('openPage')}><ExternalLink className="h-4 w-4" /></Link>}
              {selectedNode.type === 'note' && <Link href={`/notes?note=${selectedNode.slug}`} className="graph-icon-button shrink-0" aria-label={t('openNote')} title={t('openNote')}><ExternalLink className="h-4 w-4" /></Link>}
              {selectedNode.type === 'standard' && <Link href={`/standards?standard=${selectedNode.id}`} className="graph-icon-button shrink-0" aria-label={t('openStandard')} title={t('openStandard')}><ExternalLink className="h-4 w-4" /></Link>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-5 border-t border-border pt-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2><div className="space-y-3">{children}</div></section>;
}

function GraphSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-8 items-center justify-between gap-3 text-sm text-foreground cursor-pointer"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-accent-600" /></label>;
}

function GraphRange({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="block text-xs font-medium text-muted"><span className="flex items-center justify-between"><span>{label}</span><span>{value}</span></span><input type="range" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full accent-accent-600 cursor-pointer" /></label>;
}

function NodeGlyph({ type, size, centered = false }: { type: GraphNode['type']; size: number; centered?: boolean }) {
  const props = {
    ...(centered ? { x: -size / 2, y: -size / 2 } : {}),
    width: size,
    height: size,
    color: 'white',
    strokeWidth: 2,
    className: 'pointer-events-none',
    'aria-hidden': true,
  };
  if (type === 'root') return <Network {...props} />;
  if (type === 'wiki') return <BookOpen {...props} />;
  if (type === 'note-root' || type === 'note') return <NotebookPen {...props} />;
  if (type === 'note-category') return <Tags {...props} />;
  if (type === 'standard-root' || type === 'standard') return <ShieldCheck {...props} />;
  if (type === 'standard-category') return <Tags {...props} />;
  if (type === 'category') return <Tags {...props} />;
  if (type === 'folder') return <Folder {...props} />;
  return <FileText {...props} />;
}
