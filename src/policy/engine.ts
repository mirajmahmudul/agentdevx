// src/policy/engine.ts — OPA Rego policy enforcement engine

import * as fs from 'fs'
import * as path from 'path'

interface PolicyRequest {
  agent_id: string
  tool_name: string
  action: string
  params?: Record<string, any>
  principal_id?: string
}

interface PolicyResult {
  allow: boolean
  reason?: string
}

class PolicyEngine {
  private policies: Map<string, any> = new Map()

  /**
   * Load a Rego policy from file or string
   */
  async loadPolicy(name: string, regoCode: string): Promise<void> {
    // In production, this would compile Rego to WASM using @open-policy-agent/opa-wasm
    // For now, we implement a simple policy evaluator
    
    const policy = this.parseRego(regoCode)
    this.policies.set(name, policy)
  }

  /**
   * Simple Rego parser (production would use OPA WASM)
   */
  private parseRego(regoCode: string): any {
    // Extract package name
    const packageMatch = regoCode.match(/package\s+([\w.]+)/)
    const packageName = packageMatch ? packageMatch[1] : ''

    // Extract default allow value
    const defaultMatch = regoCode.match(/default\s+allow\s*=\s*(true|false)/)
    const defaultAllow = defaultMatch ? defaultMatch[1] === 'true' : false

    // Extract allow rules
    const allowRules: string[] = []
    const ruleMatches = regoCode.matchAll(/allow\s*\{([^}]+)\}/g)
    for (const match of ruleMatches) {
      allowRules.push(match[1])
    }

    return {
      packageName,
      defaultAllow,
      allowRules
    }
  }

  /**
   * Evaluate a request against loaded policies
   * Returns true if allowed, false if denied
   */
  async evaluate(request: PolicyRequest): Promise<PolicyResult> {
    // Find matching policy by package name pattern: agentdevx.tool.{tool_name}.{action}
    const policyKey = `agentdevx.tool.${request.tool_name}.${request.action}`
    const policy = this.policies.get(policyKey)

    if (!policy) {
      // No policy found, default to allow
      return { allow: true, reason: 'No policy defined' }
    }

    // Evaluate allow rules
    let allowed = policy.defaultAllow

    for (const rule of policy.allowRules) {
      // Simple rule evaluation (production would use full Rego engine)
      const conditions = rule.split('\n').filter(line => line.trim())
      
      let ruleAllows = true
      for (const condition of conditions) {
        const trimmed = condition.trim()
        
        // Handle input.agent_id == "..." conditions
        const agentMatch = trimmed.match(/input\.agent_id\s*==\s*"([^"]+)"/)
        if (agentMatch) {
          if (request.agent_id !== agentMatch[1]) {
            ruleAllows = false
          }
          continue
        }

        // Handle input.params.petId <= 100 conditions
        const paramMatch = trimmed.match(/input\.params\.(\w+)\s*(<=|>=|<|>|==)\s*(\d+)/)
        if (paramMatch) {
          const paramName = paramMatch[1]
          const operator = paramMatch[2]
          const threshold = parseInt(paramMatch[3], 10)
          const paramValue = request.params?.[paramName]

          if (paramValue === undefined) {
            ruleAllows = false
          } else {
            switch (operator) {
              case '<=': ruleAllows = paramValue <= threshold; break
              case '>=': ruleAllows = paramValue >= threshold; break
              case '<': ruleAllows = paramValue < threshold; break
              case '>': ruleAllows = paramValue > threshold; break
              case '==': ruleAllows = paramValue === threshold; break
            }
          }
        }
      }

      if (ruleAllows) {
        allowed = true
        break
      }
    }

    return {
      allow: allowed,
      reason: allowed ? 'Policy allowed' : 'Policy denied'
    }
  }

  /**
   * Clear all loaded policies
   */
  clear(): void {
    this.policies.clear()
  }
}

const policyEngine = new PolicyEngine()

export { policyEngine, PolicyEngine }
