// ============================================================
// Sync Coding Lessons to TLL (superroo-learn)
//
// Inserts the 10 portable architecture lessons extracted from
// this project into the tll_skills table so the Trading
// Learning Layer can discover and reference them.
//
// Usage:
//   node scripts/sync-coding-lessons-to-tll.js
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import '../lib/env.js';

const CODING_LESSONS = [
  {
    name: 'architecture_brain_pipeline',
    description: 'Multi-stage decision pipeline with composable, independently testable stages. Each stage (context building, scoring, risk gating, explanation, persistence) is a separate module with a single responsibility. Stages communicate through a shared context object, not direct calls. This makes the pipeline debuggable, extensible, and testable at each layer.',
    pattern_feature: 'architecture',
    pattern_value: 'brain_pipeline',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.95,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 1,
      tags: ['architecture', 'pipeline', 'modularity', 'composability'],
      category: 'architecture_pattern',
      reusable_across: ['signal_generation', 'data_processing', 'approval_workflows'],
    },
  },
  {
    name: 'architecture_gated_safety',
    description: 'Independent safety gates that each check one concern and return a pass/fail verdict with a reason. Gates are composed in a chain — all must pass for the action to proceed. Each gate has its own data source, timeout, and error handling. This prevents any single point of failure and makes safety auditing straightforward.',
    pattern_feature: 'architecture',
    pattern_value: 'gated_safety',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.95,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 2,
      tags: ['safety', 'gates', 'validation', 'audit'],
      category: 'architecture_pattern',
      reusable_across: ['payment_processing', 'user_actions', 'admin_operations'],
    },
  },
  {
    name: 'architecture_weighted_scoring',
    description: 'Composite scoring with configurable weights per dimension. Scores are calculated as weighted sums of normalized sub-scores, with each dimension independently tunable via configuration. The breakdown is always returned alongside the total, enabling explainability and post-hoc analysis of which factors drove the decision.',
    pattern_feature: 'architecture',
    pattern_value: 'weighted_scoring',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.9,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 3,
      tags: ['scoring', 'weights', 'explainability', 'configuration'],
      category: 'architecture_pattern',
      reusable_across: ['recommendation_systems', 'ranking', 'risk_assessment'],
    },
  },
  {
    name: 'architecture_signal_schema_with_ttl',
    description: 'Every data payload includes a generated_at timestamp and a ttl (time-to-live) duration. Consumers check freshness before acting on the data. This prevents stale data from driving decisions and enables automatic garbage collection of expired records. The schema also includes source, confidence, and mode (paper/live) fields for full traceability.',
    pattern_feature: 'architecture',
    pattern_value: 'signal_schema_ttl',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.95,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 4,
      tags: ['schema', 'ttl', 'freshness', 'data_quality'],
      category: 'data_pattern',
      reusable_across: ['event_sourcing', 'caching', 'real_time_systems'],
    },
  },
  {
    name: 'architecture_autonomous_learning_layer',
    description: 'Self-improving pipeline that runs on a timer: record outcomes → discover patterns → detect regime → tune weights → generate skills → heal strategies. Each step is independent and non-blocking (errors in one step don\'t stop the pipeline). Results are logged to a telemetry table for observability. The entire pipeline can be disabled via a single env var.',
    pattern_feature: 'architecture',
    pattern_value: 'autonomous_learning',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.9,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 5,
      tags: ['learning', 'automation', 'pipeline', 'telemetry'],
      category: 'architecture_pattern',
      reusable_across: ['recommendation_engines', 'a_b_testing', 'model_retraining'],
    },
  },
  {
    name: 'architecture_multi_worker_pm2',
    description: 'PM2 ecosystem config with 40+ workers, each in fork mode with dedicated log files, max memory limits, auto-restart on crash, and env-aware start/stop scripts. Workers are categorized by function (trading, data, analysis, infrastructure) with dependency ordering. A deploy-checker worker monitors git commits and auto-deploys with zero-downtime PM2 reload.',
    pattern_feature: 'architecture',
    pattern_value: 'multi_worker_pm2',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.95,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 6,
      tags: ['pm2', 'workers', 'deployment', 'monitoring'],
      category: 'infrastructure_pattern',
      reusable_across: ['microservices', 'background_jobs', 'event_driven_systems'],
    },
  },
  {
    name: 'architecture_subsystem_bridge',
    description: 'When two subsystems need to share data without coupling, use a bridge module that translates between their data models. The bridge handles deduplication, caching, and graceful degradation (failures in one subsystem don\'t crash the other). This pattern enables independent evolution of each subsystem while maintaining interoperability.',
    pattern_feature: 'architecture',
    pattern_value: 'subsystem_bridge',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.9,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 7,
      tags: ['bridge', 'decoupling', 'integration', 'resilience'],
      category: 'architecture_pattern',
      reusable_across: ['service_integration', 'data_sync', 'event_bridging'],
    },
  },
  {
    name: 'architecture_multi_agent_attribution',
    description: 'Every code change is attributed to a specific agent role via a coder signature file. Commit messages include role tags ([SB], [SA], [RS], [VD], [DOC]) for accountability. A changelog worker parses commit history and generates structured changelogs grouped by agent. This enables audit trails, performance tracking per agent, and automated changelog generation.',
    pattern_feature: 'architecture',
    pattern_value: 'multi_agent_attribution',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.85,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 8,
      tags: ['attribution', 'audit', 'changelog', 'agents'],
      category: 'process_pattern',
      reusable_across: ['team_workflows', 'ci_cd', 'compliance'],
    },
  },
  {
    name: 'architecture_deployment_verification',
    description: 'Every deployment goes through a verification phase: health endpoint check, PM2 process status, database connectivity test, and Telegram notification. A deploy_history table tracks every deployment with commit hash, status, and health check result. Failed deployments trigger automatic rollback. This creates a complete audit trail and enables rapid incident response.',
    pattern_feature: 'architecture',
    pattern_value: 'deployment_verification',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.95,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 9,
      tags: ['deployment', 'verification', 'rollback', 'monitoring'],
      category: 'infrastructure_pattern',
      reusable_across: ['ci_cd', 'release_management', 'site_reliability'],
    },
  },
  {
    name: 'architecture_env_configurable',
    description: 'Every tunable parameter comes from an environment variable with a sensible default. Configuration is centralized in a single config module that reads env vars at import time and exports a frozen config object. This enables different behavior across dev/staging/production without code changes, and makes the system auditable by listing all configurable parameters in .env.example.',
    pattern_feature: 'architecture',
    pattern_value: 'env_configurable',
    win_rate: 0.0,
    avg_pnl: 0.0,
    confidence: 0.95,
    samples: 1,
    signal: 'favorable',
    compound: false,
    metadata: {
      source: 'coding_lessons_from_trading_bot',
      lesson_number: 10,
      tags: ['configuration', 'env_vars', 'devops', 'best_practice'],
      category: 'infrastructure_pattern',
      reusable_across: ['all_projects'],
    },
  },
];

async function syncCodingLessons() {
  logger.info('[sync-coding-lessons] Starting sync of coding lessons to TLL...');

  let inserted = 0;
  let skipped = 0;

  for (const lesson of CODING_LESSONS) {
    try {
      // Check if skill already exists
      const { data: existing } = await supabase
        .from('tll_skills')
        .select('id, name')
        .eq('name', lesson.name)
        .maybeSingle();

      if (existing) {
        // Update existing skill with latest description/metadata
        const { error: updateErr } = await supabase
          .from('tll_skills')
          .update({
            description: lesson.description,
            confidence: lesson.confidence,
            active: true,
            metadata: lesson.metadata,
          })
          .eq('id', existing.id);

        if (updateErr) {
          logger.warn(`[sync-coding-lessons] Update failed for ${lesson.name}: ${updateErr.message}`);
        } else {
          logger.info(`[sync-coding-lessons] Updated existing skill: ${lesson.name}`);
          inserted++;
        }
      } else {
        // Insert new skill
        const { error: insertErr } = await supabase
          .from('tll_skills')
          .insert({
            name: lesson.name,
            description: lesson.description,
            pattern_feature: lesson.pattern_feature,
            pattern_value: lesson.pattern_value,
            win_rate: lesson.win_rate,
            avg_pnl: lesson.avg_pnl,
            confidence: lesson.confidence,
            samples: lesson.samples,
            signal: lesson.signal,
            compound: lesson.compound,
            generated_at: new Date().toISOString(),
            active: true,
            metadata: lesson.metadata,
          });

        if (insertErr) {
          logger.warn(`[sync-coding-lessons] Insert failed for ${lesson.name}: ${insertErr.message}`);
          skipped++;
        } else {
          logger.info(`[sync-coding-lessons] Inserted new skill: ${lesson.name}`);
          inserted++;
        }
      }
    } catch (e) {
      logger.error(`[sync-coding-lessons] Error processing ${lesson.name}: ${e.message}`);
      skipped++;
    }
  }

  logger.info(`[sync-coding-lessons] Sync complete: ${inserted} processed, ${skipped} skipped`);
  console.log(`\n✅ Synced ${inserted} coding lessons to TLL (superroo-learn)`);
  console.log(`   ${skipped} lessons skipped due to errors`);
  console.log(`   Total lessons defined: ${CODING_LESSONS.length}`);
}

syncCodingLessons().catch((err) => {
  console.error('❌ Sync failed:', err.message);
  process.exit(1);
});
