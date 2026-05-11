export const toolManifestSchema = {
  "title": "AgentDevX Tool Manifest",
  "description": "Machine‑executable descriptor of a software tool for AI agents.",
  "type": "object",
  "required": ["agentdevx", "tool"],
  "properties": {
    "agentdevx": {
      "type": "string",
      "const": "1.0"
    },
    "tool": {
      "type": "object",
      "required": ["name", "version", "description", "base_url", "endpoints"],
      "properties": {
        "name": { "type": "string" },
        "version": { "type": "string" },
        "description": { "type": "string" },
        "base_url": { "type": "string", "format": "uri" },
        "auth": {
          "type": "object",
          "required": ["type"],
          "properties": {
            "type": { "enum": ["none", "api_key", "oauth2", "mtls"] },
            "scopes": { "type": "array", "items": { "type": "string" } },
            "token_endpoint": { "type": "string", "format": "uri" },
            "client_credential_flow": { "type": "boolean" },
            "instructions": { "type": "string" }
          }
        },
        "endpoints": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["id", "method", "path", "request"],
            "properties": {
              "id": { "type": "string" },
              "method": { "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] },
              "path": { "type": "string" },
              "description": { "type": "string" },
              "request": {
                "type": "object",
                "required": ["headers", "body_schema"],
                "properties": {
                  "headers": {
                    "type": "object",
                    "additionalProperties": { "type": "string" }
                  },
                  "body_schema": { "$ref": "#/$defs/jsonSchema" },
                  "query_params": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "object",
                      "properties": {
                        "type": { "type": "string" },
                        "description": { "type": "string" },
                        "required": { "type": "boolean" }
                      }
                    }
                  }
                }
              },
              "response": {
                "type": "object",
                "properties": {
                  "status_codes": {
                    "type": "array",
                    "items": { "type": "integer" }
                  },
                  "success_schema": { "$ref": "#/$defs/jsonSchema" },
                  "error_schema": { "$ref": "#/$defs/jsonSchema" }
                }
              },
              "rate_limit": {
                "type": "object",
                "properties": {
                  "requests_per_minute": { "type": "integer" },
                  "burst": { "type": "integer" }
                }
              },
              "side_effects": {
                "type": "array",
                "items": { "type": "string" }
              },
              "deprecated": { "type": "boolean" },
              "examples": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "request": { "type": "object" },
                    "response": { "type": "object" }
                  }
                }
              }
            }
          }
        },
        "fallback": {
          "type": "object",
          "properties": {
            "tool": { "type": "string" },
            "version": { "type": "string" }
          }
        },
        "pricing": {
          "type": "object",
          "properties": {
            "model": { "enum": ["free", "per_request", "subscription", "usage_based"] },
            "unit_price_usd": { "type": "number" },
            "currency": { "type": "string" },
            "details": { "type": "string" }
          }
        }
      }
    }
  },
  "$defs": {
    "jsonSchema": {
      "type": "object",
      "properties": {
        "type": { "type": "string" },
        "properties": { "type": "object" },
        "required": { "type": "array", "items": { "type": "string" } },
        "additionalProperties": { "type": "boolean" },
        "items": { "$ref": "#/$defs/jsonSchema" },
        "oneOf": { "type": "array", "items": { "$ref": "#/$defs/jsonSchema" } },
        "anyOf": { "type": "array", "items": { "$ref": "#/$defs/jsonSchema" } },
        "allOf": { "type": "array", "items": { "$ref": "#/$defs/jsonSchema" } },
        "enum": { "type": "array" },
        "description": { "type": "string" },
        "default": {},
        "examples": { "type": "array" }
      },
      "additionalProperties": true
    }
  }
}