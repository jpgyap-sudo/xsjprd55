-- ============================================================
-- Agent Deployment Tracking Schema
-- Tracks all coding agent changes, commits, and deployments
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Table: agent_changes
-- Tracks every change made by coding agents
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type TEXT NOT NULL CHECK (agent_type IN (
        'Senior Builder',
        'Signal Analyst', 
        'Risk & Security Reviewer',
        'DevOps & Infrastructure',
        'VPS Deployer Agent',
        'Bug Hunter',
        'ML Service Agent',
        'Documentation Maintainer',
        'unknown'
    )),
    commit_hash TEXT,
    commit_message TEXT,
    branch TEXT NOT NULL DEFAULT 'main',
    previous_commit TEXT,
    
    -- File change counts
    files_total INTEGER DEFAULT 0,
    files_api INTEGER DEFAULT 0,
    files_workers INTEGER DEFAULT 0,
    files_lib INTEGER DEFAULT 0,
    files_scripts INTEGER DEFAULT 0,
    files_tests INTEGER DEFAULT 0,
    files_sql INTEGER DEFAULT 0,
    files_docs INTEGER DEFAULT 0,
    
    -- File list (up to 20 files)
    file_list TEXT[],
    
    -- Change classification
    change_category TEXT CHECK (change_category IN (
        'feature',
        'bugfix',
        'hotfix',
        'refactor',
        'config',
        'docs',
        'schema',
        'security',
        'test'
    )),
    
    -- Deployment tracking
    deployment_status TEXT NOT NULL DEFAULT 'pending' CHECK (deployment_status IN (
        'pending',
        'committed',
        'queued',
        'deploying',
        'deployed',
        'failed',
        'rolled_back',
        'skipped'
    )),
    
    -- Timestamps
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    committed_at TIMESTAMPTZ,
    queued_at TIMESTAMPTZ,
    deploy_started_at TIMESTAMPTZ,
    deploy_finished_at TIMESTAMPTZ,
    
    -- Deployment details
    deployed_to TEXT, -- 'vps', 'staging', 'production'
    deploy_log TEXT,
    deploy_error TEXT,
    
    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,
    
    -- Rollback info
    rolled_back BOOLEAN DEFAULT FALSE,
    rolled_back_at TIMESTAMPTZ,
    rollback_commit TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_changes_agent_type ON agent_changes(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_changes_status ON agent_changes(deployment_status);
CREATE INDEX IF NOT EXISTS idx_agent_changes_commit ON agent_changes(commit_hash);
CREATE INDEX IF NOT EXISTS idx_agent_changes_branch ON agent_changes(branch);
CREATE INDEX IF NOT EXISTS idx_agent_changes_detected ON agent_changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_changes_deployed ON agent_changes(deployed_at DESC);

-- ============================================================
-- Table: deployment_queue
-- Queue for pending deployments
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_change_id UUID REFERENCES agent_changes(id) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    
    -- Queue status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled'
    )),
    
    -- Deployment target
    target TEXT NOT NULL DEFAULT 'vps' CHECK (target IN (
        'vps',
        'staging',
        'production'
    )),
    
    -- Processing
    processed_by TEXT,
    processed_at TIMESTAMPTZ,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Error tracking
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployment_queue_status ON deployment_queue(status);
CREATE INDEX IF NOT EXISTS idx_deployment_queue_priority ON deployment_queue(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_deployment_queue_commit ON deployment_queue(commit_hash);

-- ============================================================
-- Table: deployment_history
-- Complete deployment audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_change_id UUID REFERENCES agent_changes(id) ON DELETE SET NULL,
    queue_id UUID REFERENCES deployment_queue(id) ON DELETE SET NULL,
    
    -- Commit info
    commit_sha TEXT NOT NULL,
    commit_message TEXT,
    commit_author TEXT,
    previous_commit TEXT,
    
    -- Deployment info
    deployed_from TEXT, -- 'github', 'local', 'auto'
    deployed_to TEXT NOT NULL,
    deployed_by TEXT,
    
    -- Status
    deploy_status TEXT NOT NULL CHECK (deploy_status IN (
        'success',
        'failed',
        'rolled_back',
        'timeout',
        'cancelled'
    )),
    
    -- Health checks
    health_check_passed BOOLEAN DEFAULT FALSE,
    pm2_restarted BOOLEAN DEFAULT FALSE,
    
    -- VPS specific
    vps_ip TEXT,
    vps_user TEXT,
    
    -- Files changed
    files_changed TEXT[],
    files_added INTEGER DEFAULT 0,
    files_modified INTEGER DEFAULT 0,
    files_deleted INTEGER DEFAULT 0,
    
    -- Timings
    deploy_started_at TIMESTAMPTZ,
    deploy_finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Logs
    deploy_log TEXT,
    error_log TEXT,
    
    -- Rollback
    rolled_back BOOLEAN DEFAULT FALSE,
    rollback_reason TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployment_history_commit ON deployment_history(commit_sha);
CREATE INDEX IF NOT EXISTS idx_deployment_history_status ON deployment_history(deploy_status);
CREATE INDEX IF NOT EXISTS idx_deployment_history_created ON deployment_history(created_at DESC);

-- ============================================================
-- Table: deployment_approvals
-- For manual approval gates
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_change_id UUID REFERENCES agent_changes(id) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    
    -- Approval status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'approved',
        'rejected',
        'auto_approved'
    )),
    
    -- Who approved/rejected
    requested_by TEXT,
    approved_by TEXT,
    rejected_by TEXT,
    
    -- Timestamps
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    
    -- Reason
    request_reason TEXT,
    rejection_reason TEXT,
    
    -- Auto-approval settings
    auto_approved BOOLEAN DEFAULT FALSE,
    auto_approve_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table: agent_activity_log
-- Real-time activity tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type TEXT NOT NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'change_detected',
        'commit_created',
        'push_initiated',
        'deploy_queued',
        'deploy_started',
        'deploy_completed',
        'deploy_failed',
        'rollback_initiated',
        'health_check',
        'verification_passed',
        'verification_failed'
    )),
    commit_hash TEXT,
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_log_agent ON agent_activity_log(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_type ON agent_activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_created ON agent_activity_log(created_at DESC);

-- Row Level Security (RLS) Policies
ALTER TABLE agent_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_activity_log ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (adjust per your auth setup)
CREATE POLICY "Allow all operations" ON agent_changes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON deployment_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON deployment_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON deployment_approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON agent_activity_log FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Functions
-- ============================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_agent_changes_updated_at ON agent_changes;
CREATE TRIGGER update_agent_changes_updated_at
    BEFORE UPDATE ON agent_changes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_deployment_queue_updated_at ON deployment_queue;
CREATE TRIGGER update_deployment_queue_updated_at
    BEFORE UPDATE ON deployment_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_deployment_approvals_updated_at ON deployment_approvals;
CREATE TRIGGER update_deployment_approvals_updated_at
    BEFORE UPDATE ON deployment_approvals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to log agent activity
CREATE OR REPLACE FUNCTION log_agent_activity(
    p_agent_type TEXT,
    p_activity_type TEXT,
    p_commit_hash TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO agent_activity_log (agent_type, activity_type, commit_hash, message, metadata)
    VALUES (p_agent_type, p_activity_type, p_commit_hash, p_message, p_metadata)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Function to queue deployment
CREATE OR REPLACE FUNCTION queue_deployment(
    p_commit_hash TEXT,
    p_branch TEXT DEFAULT 'main',
    p_target TEXT DEFAULT 'vps',
    p_priority INTEGER DEFAULT 5
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO deployment_queue (commit_hash, branch, target, priority)
    VALUES (p_commit_hash, p_branch, p_target, p_priority)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Views
-- ============================================================

-- Pending deployments view
CREATE OR REPLACE VIEW pending_deployments AS
SELECT 
    ac.*,
    dq.id as queue_id,
    dq.priority,
    dq.attempts,
    EXTRACT(EPOCH FROM (NOW() - ac.detected_at))/60 as minutes_since_detection
FROM agent_changes ac
LEFT JOIN deployment_queue dq ON ac.id = dq.agent_change_id
WHERE ac.deployment_status IN ('pending', 'committed', 'queued')
ORDER BY dq.priority ASC, ac.detected_at ASC;

-- Recent deployment activity view
CREATE OR REPLACE VIEW recent_deployment_activity AS
SELECT 
    dh.*,
    ac.agent_type,
    ac.change_category,
    ac.files_total
FROM deployment_history dh
LEFT JOIN agent_changes ac ON dh.agent_change_id = ac.id
WHERE dh.created_at > NOW() - INTERVAL '24 hours'
ORDER BY dh.created_at DESC;

-- Agent productivity view
CREATE OR REPLACE VIEW agent_productivity AS
SELECT 
    agent_type,
    COUNT(*) as total_changes,
    COUNT(*) FILTER (WHERE deployment_status = 'deployed') as deployed_count,
    COUNT(*) FILTER (WHERE deployment_status = 'failed') as failed_count,
    AVG(EXTRACT(EPOCH FROM (deploy_finished_at - deploy_started_at))) as avg_deploy_time_seconds
FROM agent_changes
WHERE detected_at > NOW() - INTERVAL '7 days'
GROUP BY agent_type;

-- ============================================================
-- Comments for documentation
-- ============================================================
COMMENT ON TABLE agent_changes IS 'Tracks all coding agent changes before and during deployment';
COMMENT ON TABLE deployment_queue IS 'Queue for pending deployments with priority and retry logic';
COMMENT ON TABLE deployment_history IS 'Complete audit trail of all deployments';
COMMENT ON TABLE deployment_approvals IS 'Manual approval gates for sensitive deployments';
COMMENT ON TABLE agent_activity_log IS 'Real-time activity log for monitoring';

-- ============================================================
-- Initial data (optional)
-- ============================================================
-- Insert a test entry to verify the schema
-- INSERT INTO agent_changes (agent_type, deployment_status, metadata)
-- VALUES ('Senior Builder', 'pending', '{"test": true}');