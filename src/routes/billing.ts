// src/routes/billing.ts — Stripe billing integration

import { Hono } from 'hono'
import Stripe from 'stripe'
import { supabase } from '../db'

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia'
    })
  : null

const billingRoute = new Hono()

/**
 * POST /billing/checkout — Create a Stripe Checkout Session for Pro/Team tiers
 * Body: { tier: 'pro' | 'team', success_url, cancel_url }
 */
billingRoute.post('/checkout', async (c) => {
  if (!stripe) {
    return c.json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in environment.' }, 503)
  }

  const { tier, success_url, cancel_url } = await c.req.json()

  if (!tier || !['pro', 'team'].includes(tier)) {
    return c.json({ error: 'Invalid tier. Must be "pro" or "team"' }, 400)
  }

  if (!success_url || !cancel_url) {
    return c.json({ error: 'success_url and cancel_url are required' }, 400)
  }

  // Define pricing based on tier
  const priceMap: Record<string, string> = {
    pro: process.env.STRIPE_PRICE_ID_PRO || 'price_pro_default',
    team: process.env.STRIPE_PRICE_ID_TEAM || 'price_team_default'
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceMap[tier],
          quantity: 1
        }
      ],
      success_url,
      cancel_url,
      metadata: {
        tier
      }
    })

    return c.json({ 
      url: session.url,
      session_id: session.id
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/**
 * POST /billing/webhook — Handle Stripe webhooks
 */
billingRoute.post('/webhook', async (c) => {
  if (!stripe) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  const body = await c.req.text()
  const sig = c.req.header('Stripe-Signature') || ''

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    )
  } catch (err: any) {
    return c.json({ error: 'Webhook signature verification failed' }, 400)
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    
    // Update user's subscription status in database
    const customerId = session.customer as string
    const tier = session.metadata?.tier || 'pro'

    await supabase
      .from('subscriptions')
      .upsert({
        customer_id: customerId,
        tier,
        status: 'active',
        stripe_session_id: session.id,
        updated_at: new Date().toISOString()
      })
  }

  // Handle customer.subscription.deleted
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    
    await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('customer_id', subscription.customer as string)
  }

  return c.json({ received: true })
})

/**
 * GET /billing/usage — Show current usage stats for an agent
 * Query: { agent_id }
 */
billingRoute.get('/usage', async (c) => {
  const agent_id = c.req.query('agent_id')

  if (!agent_id) {
    return c.json({ error: 'agent_id query parameter is required' }, 400)
  }

  // Get current billing period (last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Count proxy calls from audit_log
  const { count, error } = await supabase
    .from('audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agent_id)
    .gte('timestamp', thirtyDaysAgo.toISOString())

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Get subscription tier
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('agent_id', agent_id)
    .single()

  const tierLimits: Record<string, number> = {
    free: 1000,
    pro: 50000,
    team: 500000
  }

  const currentTier = subscription?.status === 'active' ? (subscription.tier || 'free') : 'free'
  const limit = tierLimits[currentTier] || 1000

  return c.json({
    agent_id,
    tier: currentTier,
    calls_last_30_days: count || 0,
    limit,
    remaining: Math.max(0, limit - (count || 0)),
    period_start: thirtyDaysAgo.toISOString(),
    period_end: new Date().toISOString()
  })
})

export { billingRoute }
