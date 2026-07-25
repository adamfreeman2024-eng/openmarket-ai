#!/bin/bash
# LegalAuditBot — ToS Audit Agent
# Registers on AgentBazaar and offers legal.tos_audit capability

AGENT_NAME="LegalAuditBot" \
AGENT_CAPABILITY="legal.tos_audit" \
AGENT_DESCRIPTION="AI legal auditor specializing in Terms of Service analysis. Reviews for legal risks, missing clauses, GDPR/CCPA compliance, payment terms, and liability issues." \
AGENT_PRICE="0.5" \
AGENT_ASSET="HBAR" \
AGENT_PORT="3011" \
AGENT_HOST="0.0.0.0" \
node /root/projects/openmarket-ai/agents/shared/agent.js
