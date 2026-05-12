// src/policy/engine.ts — OPA Rego policy enforcement engine

import * as fs from 'fs'
import * as path from 'path'
import { Policy } from '@open-policy-agent/opa-wasm'

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
  private wasmPolicies: Map<string, Policy> = new Map()

  /**
   * Load a Rego policy from WASM bundle
   * In production, policies are pre-compiled to WASM using: opa build -t wasm policy.rego
   */
  async loadPolicyFromWasm(name: string, wasmPath: string): Promise<void> {
    try {
      const wasmBuffer = fs.readFileSync(wasmPath)
      const policy = await Policy.load(wasmBuffer)
      this.wasmPolicies.set(name, policy)
      console.log(`[PolicyEngine] Loaded WASM policy: ${name}`)
    } catch (error) {
      console.error(`[PolicyEngine] Failed to load WASM policy ${name}:`, error)
      throw error
    }
  }

  /**
   * Load a Rego policy from file or string (interpreter fallback)
   */
  async loadPolicy(name: string, regoCode: string): Promise<void> {
    // Try to load WASM policy first if available
    const wasmPath = path.join(process.cwd(), 'policies', `${name.replace(/\./g, '_')}.wasm`)
    if (fs.existsSync(wasmPath)) {
      await this.loadPolicyFromWasm(name, wasmPath)
      return
    }

    // Fallback to interpreter mode
    const policy = this.parseRego(regoCode)
    this.policies.set(name, policy)
    console.log(`[PolicyEngine] Loaded interpreted policy: ${name}`)
  }

  /**
   * Simple Rego parser (fallback when WASM not available)
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
    
    // Try WASM policy first
    const wasmPolicy = this.wasmPolicies.get(policyKey)
    if (wasmPolicy) {
      try {
        const input = {
          agent_id: request.agent_id,
          tool_name: request.tool_name,
          action: request.action,
          params: request.params || {},
          principal_id: request.principal_id
        }
        
        const result = wasmPolicy.evaluate(input)
        const allow = result?.allow ?? false
        
        return {
          allow,
          reason: allow ? 'Policy allowed' : 'Policy denied'
        }
      } catch (error) {
        console.error(`[PolicyEngine] WASM evaluation error:`, error)
        return { allow: false, reason: 'Policy evaluation error' }
      }
    }

    // Fallback to interpreter mode
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
    this.wasmPolicies.clear()
  }
}

const policyEngine = new PolicyEngine()

export { policyEngine, PolicyEngine }
