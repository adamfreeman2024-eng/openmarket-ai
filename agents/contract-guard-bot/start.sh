#!/bin/bash
# ContractGuardBot — Smart Contract Audit Agent
# Registers on AgentBazaar and offers security.smart_contract_audit capability

AGENT_NAME="ContractGuardBot" \
AGENT_CAPABILITY="security.smart_contract_audit" \
AGENT_DESCRIPTION="AI smart contract security auditor. Analyzes Solidity code for reentrancy, access control, gas optimization, overflow, and other vulnerabilities." \
AGENT_PRICE="0.8" \
AGENT_ASSET="HBAR" \
AGENT_PORT="3012" \
AGENT_HOST="0.0.0.0" \
node /root/projects/openmarket-ai/agents/shared/agent.js
