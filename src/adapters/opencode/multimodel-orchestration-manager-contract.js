import { normalizeRouterSchemaV3 } from '../../core/router-schema-v3.js';
import {
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
} from './multimodel-contract.js';

export const MULTIMODEL_ORCHESTRATION_MANAGER_CONTRACT_VERSION = '1';

export function createMultimodelOrchestrationManagerContract(input = {}) {
  const schemaFacts = normalizeSchemaFacts(input.schemaFacts ?? input.routerSchemaContract ?? input.source ?? input.config);
  const browseProjection = normalizeBrowseProjection(
    input.browseProjection ?? createDefaultBrowseProjection(schemaFacts),
  );
  const compareProjection = normalizeCompareProjection(
    input.compareProjection ?? createDefaultCompareProjection(schemaFacts, browseProjection),
  );
  const selector = browseProjection?.resolvedSelector ?? browseProjection?.selector ?? buildSelectorText(
    schemaFacts.activeCatalogName,
    schemaFacts.activePresetName,
  );
  const planId = normalizePlanId(input.planId, selector, schemaFacts, compareProjection);
  const reportRefs = normalizeReportRefs(input.reportRefs);
  const phases = collectPhasePlans(schemaFacts, compareProjection, planId);
  const split = phases.map((phase) => phase.split);
  const dispatch = phases.flatMap((phase) => phase.dispatch);
  const judge = phases.flatMap((phase) => phase.judge);
  const radar = phases.flatMap((phase) => phase.radar);
  const merge = buildMergeStep(planId, split, dispatch, judge, radar);
  const complexity = summarizeComplexity(schemaFacts, phases, compareProjection);
  const recovery = buildRecoveryEnvelope({
    planId,
    parentPlanId: input.parentPlanId ?? null,
    cursor: input.cursor ?? dispatch[0]?.dispatchId ?? split[0]?.splitId ?? planId,
    sourceEnvelopeIds: reportRefs.map((entry) => entry.name),
    handoffTarget: input.handoffTarget ?? null,
  });

  return {
    kind: 'multimodel-orchestration-manager-contract',
    contractVersion: MULTIMODEL_ORCHESTRATION_MANAGER_CONTRACT_VERSION,
    schemaVersion: schemaFacts.version ?? schemaFacts.sourceVersion ?? 3,
    planId,
    parentPlanId: input.parentPlanId ?? null,
    source: buildSourceSummary(schemaFacts, browseProjection, compareProjection),
    inputs: {
      schemaFacts: summarizeSchemaFacts(schemaFacts),
      browseProjection,
      compareProjection,
      reportRefs,
    },
    split,
    dispatch,
    merge,
    judge,
    radar,
    complexity,
    recovery,
    policy: {
      nonExecuting: true,
      nonRoutingMutation: true,
      routerExternal: true,
    },
  };
}

function normalizeSchemaFacts(source) {
  if (!source) {
    throw new Error('multimodel orchestration manager requires schema v3 facts.');
  }

  if (source.kind === 'router-schema-v3-view') {
    return source;
  }

  return normalizeRouterSchemaV3(source);
}

function createDefaultBrowseProjection(schemaFacts) {
  return createMultimodelBrowseContract(schemaFacts, {
    catalog: schemaFacts.activeCatalogName,  // 'catalog' key required by multimodel selector API
    preset: schemaFacts.activePresetName,
  });
}

function createDefaultCompareProjection(schemaFacts, browseProjection) {
  const selector = selectComparisonSelector(schemaFacts, browseProjection);
  if (!selector) {
    return null;
  }

  return createMultimodelCompareContract(schemaFacts, browseProjection.resolvedSelector ?? browseProjection.selector, selector);
}

function selectComparisonSelector(schemaFacts, browseProjection) {
  const selectedSdd = schemaFacts.catalogs?.find((sdd) => sdd.name === browseProjection?.catalog?.name)
    ?? schemaFacts.selectedCatalog
    ?? schemaFacts.catalogs?.[0]
    ?? null;
  const selectedPresetName = browseProjection?.preset?.name ?? schemaFacts.activePresetName ?? schemaFacts.selectedPreset?.name ?? null;
  const alternatives = selectedSdd?.presets?.filter((preset) => preset.name !== selectedPresetName) ?? [];

  if (alternatives.length === 0) {
    return null;
  }

  return buildSelectorText(selectedSdd.name, alternatives[0].name);
}

function collectPhasePlans(schemaFacts, compareProjection, planId) {
  const resolvedPhases = schemaFacts.resolvedPhases ?? {};
  const compareHasBoundary = hasComparisonBoundary(compareProjection);
  const phaseEntries = Object.entries(resolvedPhases);
  const plans = [];

  for (const [index, [phaseName, phase]] of phaseEntries.entries()) {
    const splitId = `${planId}:split:${index + 1}:${phaseName}`;
    const laneCandidates = Array.isArray(phase?.candidates) ? [...phase.candidates] : [];
    const orderedLanes = laneCandidates.sort((left, right) => laneRoleRank(left?.role) - laneRoleRank(right?.role));
    const phaseRoles = new Set((phase?.roles ?? []).filter(Boolean));
    const phaseParallelSafe = laneCandidates.length > 1
      && !compareHasBoundary
      && !phaseRoles.has('judge')
      && !phaseRoles.has('radar');
    const split = {
      kind: 'split-unit',
      splitId,
      phase: phaseName,
      subject: `${schemaFacts.activeCatalogName ?? 'sdd'}/${schemaFacts.activePresetName ?? 'preset'}:${phaseName}`,
      dependencyRefs: index > 0 && !phaseParallelSafe ? [`${planId}:split:${index}:${phaseEntries[index - 1][0]}`] : [],
      dispatchRefs: [],
      laneRoles: Array.from(phaseRoles),
      reason: phaseParallelSafe
        ? `Phase ${phaseName} can be split into parallel-safe branches.`
        : `Phase ${phaseName} requires sequential observation or comparison before merge.`,
    };

    const dispatch = orderedLanes.map((lane, laneIndex) => {
      const dispatchId = `${splitId}:dispatch:${laneIndex + 1}`;
      const isObservationLane = lane?.role === 'judge' || lane?.role === 'radar';
      const order = phaseParallelSafe && !isObservationLane ? 'parallel' : 'sequential';
      const dependencyRefs = [];

      if (!phaseParallelSafe && index > 0) {
        dependencyRefs.push(split.dependencyRefs[0] ?? `${planId}:split:${index}:${phaseEntries[index - 1][0]}`);
      }

      if (isObservationLane) {
        const priorDispatch = split.dispatchRefs.find(Boolean);
        if (priorDispatch) {
          dependencyRefs.push(priorDispatch);
        }
      }

      split.dispatchRefs.push(dispatchId);

      return {
        kind: 'dispatch-unit',
        dispatchId,
        splitId,
        phase: phaseName,
        laneRole: lane?.role ?? 'primary',
        target: lane?.target ?? null,
        order,
        dependencyRefs: Array.from(new Set(dependencyRefs)),
        fallbackTargets: normalizeStringList(lane?.fallbacks),
        reason: isObservationLane
          ? `Lane role ${lane?.role ?? 'primary'} observes or validates a prior output.`
          : order === 'parallel'
            ? `Lane role ${lane?.role ?? 'primary'} is parallel-safe.`
            : `Lane role ${lane?.role ?? 'primary'} is sequenced by the compare boundary.`,
      };
    });

    const judge = [];
    const radar = [];

    for (const lane of laneCandidates) {
      if (lane?.role === 'judge') {
        const judgeStepId = `${splitId}:judge:${judge.length + 1}`;
        judge.push({
          kind: 'judge-step',
          stepId: judgeStepId,
          splitId,
          boundary: phaseName,
          decisionScope: `${phaseName}:${lane.role}`,
          decision: compareHasBoundary ? 'hold' : 'approve',
          evidenceRefs: split.dispatchRefs.slice(),
          reason: compareHasBoundary
            ? `Compare projection exposes a boundary for ${phaseName}.`
            : `Lane role ${lane.role} marks a decision boundary for ${phaseName}.`,
        });
      }

      if (lane?.role === 'radar') {
        const radarStepId = `${splitId}:radar:${radar.length + 1}`;
        radar.push({
          kind: 'radar-step',
          stepId: radarStepId,
          splitId,
          signalScope: `${phaseName}:${lane.role}`,
          signal: compareHasBoundary ? 'divergence' : 'observation',
          evidenceRefs: split.dispatchRefs.slice(),
          reason: compareHasBoundary
            ? `Compare projection reports divergence for ${phaseName}.`
            : `Lane role ${lane.role} only signals observation for ${phaseName}.`,
        });
      }
    }

    if (compareHasBoundary && index === phaseEntries.length - 1) {
      const mergeJudgeId = `${planId}:judge:merge`;
      judge.push({
        kind: 'judge-step',
        stepId: mergeJudgeId,
        splitId,
        boundary: 'merge',
        decisionScope: `${browseProjectionSelector(schemaFacts)} -> merge`,
        decision: 'hold',
        evidenceRefs: split.dispatchRefs.slice(),
        reason: 'Compare projection shows a merge boundary that needs review before completion.',
      });

      radar.push({
        kind: 'radar-step',
        stepId: `${planId}:radar:merge`,
        splitId,
        signalScope: 'compare-projection',
        signal: 'divergence',
        evidenceRefs: split.dispatchRefs.slice(),
        reason: 'Compare projection is used only to observe divergence around the merge boundary.',
      });
    }

    plans.push({
      split,
      dispatch,
      judge,
      radar,
      parallelSafe: phaseParallelSafe,
    });
  }

  return plans;
}

function buildMergeStep(planId, split, dispatch, judge, radar) {
  return {
    kind: 'merge-step',
    mergeId: `${planId}:merge`,
    inputs: dispatch.map((item) => item.dispatchId),
    judgeRefs: judge.map((item) => item.stepId),
    radarRefs: radar.map((item) => item.stepId),
    produces: {
      kind: 'multimodel-orchestration-merge',
      summary: 'Merge report-only planning metadata without mutating routing or execution state.',
      splitCount: split.length,
      dispatchCount: dispatch.length,
    },
  };
}

function summarizeComplexity(schemaFacts, phasePlans, compareProjection) {
  const mode = phasePlans.every((phase) => phase.parallelSafe) ? 'parallel' : 'sequential';
  const recommendation = schemaFacts.complexityGuidance?.recommendation ?? schemaFacts.complexityGuidance?.default ?? null;
  const laneCount = Number.isInteger(recommendation?.laneCount)
    ? recommendation.laneCount
    : dispatchLaneCount(phasePlans);

  return {
    mode,
    reason: mode === 'parallel'
      ? 'Independent branches can be dispatched in parallel from the resolved schema v3 facts.'
      : hasComparisonBoundary(compareProjection)
        ? 'A compare boundary requires sequential dispatch around the merge point.'
        : 'Judge or radar lanes require sequential observation before merge.',
    laneCount,
  };
}

function buildRecoveryEnvelope({ planId, parentPlanId, cursor, sourceEnvelopeIds, handoffTarget }) {
  return {
    resumeToken: planId,
    cursor,
    sourceEnvelopeIds: Array.from(new Set(sourceEnvelopeIds.filter(Boolean))),
    handoffTarget: handoffTarget ?? null,
    parentPlanId,
  };
}

function buildSourceSummary(schemaFacts, browseProjection, compareProjection) {
  return {
    catalog: {
      name: schemaFacts.activeCatalogName ?? null,
      availability: schemaFacts.selectedCatalog?.availability ?? null,
      labels: collectLabels(schemaFacts.selectedCatalog),
    },
    preset: {
      name: schemaFacts.activePresetName ?? null,
      availability: schemaFacts.selectedPreset?.availability ?? null,
      complexity: cloneValue(schemaFacts.complexityGuidance?.complexity ?? schemaFacts.selectedPreset?.complexity ?? null),
      laneCount: schemaFacts.complexityGuidance?.recommendation?.laneCount ?? null,
    },
    selector: browseProjection?.resolvedSelector ?? browseProjection?.selector ?? buildSelectorText(
      schemaFacts.activeCatalogName,
      schemaFacts.activePresetName,
    ),
    compare: compareProjection ? {
      left: compareProjection.leftResolvedSelector ?? compareProjection.leftSelector ?? null,
      right: compareProjection.rightResolvedSelector ?? compareProjection.rightSelector ?? null,
      differenceCount: Array.isArray(compareProjection.differences) ? compareProjection.differences.length : 0,
    } : null,
  };
}

function summarizeSchemaFacts(schemaFacts) {
  return {
    version: schemaFacts.version ?? schemaFacts.sourceVersion ?? 3,
    activeCatalogName: schemaFacts.activeCatalogName ?? null,
    activePresetName: schemaFacts.activePresetName ?? null,
    activeProfileName: schemaFacts.activeProfileName ?? null,
    laneRoles: Array.isArray(schemaFacts.laneRoles) ? [...schemaFacts.laneRoles] : [],
    compatibilityNotes: Array.isArray(schemaFacts.compatibilityNotes) ? [...schemaFacts.compatibilityNotes] : [],
    complexityGuidance: cloneValue(schemaFacts.complexityGuidance ?? null),
    phases: Object.entries(schemaFacts.resolvedPhases ?? {}).map(([phaseName, phase]) => ({
      name: phaseName,
      activeRole: phase?.active?.role ?? null,
      laneCount: Array.isArray(phase?.candidates) ? phase.candidates.length : 0,
      roles: Array.isArray(phase?.roles) ? [...phase.roles] : [],
    })),
  };
}

function normalizeBrowseProjection(projection) {
  return projection ? cloneValue(projection) : null;
}

function normalizeCompareProjection(projection) {
  return projection ? cloneValue(projection) : null;
}

function normalizeReportRefs(reportRefs) {
  if (!reportRefs) {
    return [];
  }

  if (Array.isArray(reportRefs)) {
    return reportRefs.map((entry) => (isObject(entry) ? cloneValue(entry) : { name: String(entry), status: null })).filter(Boolean);
  }

  if (!isObject(reportRefs)) {
    return [];
  }

  return Object.entries(reportRefs)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => ({
      name,
      kind: value?.kind ?? null,
      status: value?.status ?? value?.supportLevel ?? null,
      contractVersion: value?.contractVersion ?? null,
    }));
}

function hasComparisonBoundary(compareProjection) {
  return Array.isArray(compareProjection?.differences) && compareProjection.differences.length > 0;
}

function browseProjectionSelector(schemaFacts) {
  return buildSelectorText(schemaFacts.activeCatalogName, schemaFacts.activePresetName);
}

function dispatchLaneCount(phasePlans) {
  return phasePlans.reduce((total, phase) => total + phase.dispatch.length, 0);
}

function normalizePlanId(planId, selector, schemaFacts, compareProjection) {
  if (typeof planId === 'string' && planId.trim()) {
    return planId.trim();
  }

  const comparisonPart = compareProjection?.rightResolvedSelector ?? compareProjection?.rightSelector ?? 'self';
  return [
    'mmo-orchestration',
    selector ?? browseProjectionSelector(schemaFacts),
    `v${schemaFacts.version ?? schemaFacts.sourceVersion ?? 3}`,
    comparisonPart,
  ].map((part) => normalizeToken(part)).join(':');
}

function normalizeToken(value) {
  return String(value ?? 'unknown').trim().replace(/\s+/g, '-').replace(/\//g, '-');
}

function laneRoleRank(role) {
  if (role === 'primary') {
    return 0;
  }

  if (role === 'secondary') {
    return 1;
  }

  if (role === 'tertiary') {
    return 2;
  }

  if (role === 'judge') {
    return 3;
  }

  if (role === 'radar') {
    return 4;
  }

  return 5;
}

function buildSelectorText(sddName, presetName) {
  if (sddName && presetName) {
    return `${sddName}/${presetName}`;
  }

  return sddName ?? presetName ?? null;
}

function collectLabels(entry) {
  const labels = [];

  if (Array.isArray(entry?.labels)) {
    labels.push(...entry.labels);
  }

  labels.push(...normalizeStringList(entry?.metadata?.labels));
  labels.push(...normalizeStringList(entry?.metadata?.tags));
  labels.push(...normalizeStringList(entry?.aliases));

  return Array.from(new Set(labels.filter(Boolean)));
}

function normalizeStringList(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item, null)).filter(Boolean);
}

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }

  return value;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
