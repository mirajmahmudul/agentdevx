import { Hono } from 'hono';
import { supabase } from '../db.js';
import { signJWT, verifyToken } from '../auth/jwt.js';

type UserRegisterRequest = {
  email: string;
};

type UserLoginRequest = {
  email: string;
  api_key: string;
};

type TopupRequest = {
  user_id: string;
  amount: number;
};

const users = new Hono();

/**
 * Middleware to check admin role
 */
async function requireAdmin(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header required' }, 401);
  }

  const token = authHeader.substring(7);
  const payload = await verifyToken(token);
  
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  if (payload.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  c.set('userId', payload.sub);
  c.set('userRole', payload.role);
  await next();
}

/**
 * POST /users/register
 * Register a new user with email, creates user + credit row with 75k balance
 */
users.post('/register', async (c) => {
  try {
    const body = await c.req.json<UserRegisterRequest>();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return c.json({ error: 'Email is required' }, 400);
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return c.json({ error: 'User already exists' }, 409);
    }

    // Create user and credits in a transaction-like manner
    // First create the user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({ email })
      .select()
      .single();

    if (userError || !newUser) {
      console.error('Failed to create user:', userError);
      return c.json({ error: 'Failed to create user' }, 500);
    }

    // Then create the credits row
    const { error: creditsError } = await supabase
      .from('credits')
      .insert({ user_id: newUser.id, balance: 75000 });

    if (creditsError) {
      console.error('Failed to create credits:', creditsError);
      // Rollback: delete the user
      await supabase.from('users').delete().eq('id', newUser.id);
      return c.json({ error: 'Failed to create credits' }, 500);
    }

    return c.json({
      user_id: newUser.id,
      api_key: newUser.api_key,
      message: 'User registered successfully. Save your API key!'
    }, 201);
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /users/login
 * Login with email + api_key, returns short-lived JWT
 */
users.post('/login', async (c) => {
  try {
    const body = await c.req.json<UserLoginRequest>();
    const { email, api_key } = body;

    if (!email || !api_key) {
      return c.json({ error: 'Email and API key are required' }, 400);
    }

    // Find user by email and api_key
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .eq('api_key', api_key)
      .single();

    if (error || !user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Determine if this is an admin user
    const isAdmin = user.email === 'admin@agentdevx.dev';

    // Generate JWT with user claims
    const token = await signJWT({
      sub: user.id,
      email: user.email,
      role: isAdmin ? 'admin' : 'user'
    });

    return c.json({
      token,
      user_id: user.id,
      role: isAdmin ? 'admin' : 'user',
      expires_in: 3600 // 1 hour
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /users/me
 * Get current user info and credit balance (requires JWT)
 */
users.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization header required' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token);
    
    if (!payload) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const userId = payload.sub as string;

    // Get user info
    const { data: user } = await supabase
      .from('users')
      .select('id, email, created_at')
      .eq('id', userId)
      .single();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get credit balance
    const { data: credits } = await supabase
      .from('credits')
      .select('balance, updated_at')
      .eq('user_id', userId)
      .single();

    return c.json({
      user_id: user.id,
      email: user.email,
      created_at: user.created_at,
      credits: credits?.balance ?? 0,
      credits_updated: credits?.updated_at,
      role: payload.role
    });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /admin/credits/topup
 * Admin endpoint to add credits to a user
 */
users.post('/admin/credits/topup', requireAdmin, async (c) => {
  try {
    const body = await c.req.json<TopupRequest>();
    const { user_id, amount } = body;

    if (!user_id || typeof amount !== 'number' || amount <= 0) {
      return c.json({ error: 'Valid user_id and positive amount required' }, 400);
    }

    // Check if user exists
    const { data: user } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', user_id)
      .single();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Update credits
    const { error } = await supabase
      .from('credits')
      .update({ balance: supabase.raw('balance + ?', amount) })
      .eq('user_id', user_id);

    if (error) {
      console.error('Topup error:', error);
      return c.json({ error: 'Failed to add credits' }, 500);
    }

    // Get new balance
    const { data: updatedCredits } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single();

    return c.json({
      message: `Added ${amount} credits to ${user.email}`,
      user_id: user_id,
      new_balance: updatedCredits?.balance ?? amount
    });
  } catch (error) {
    console.error('Topup error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /admin/stats/users
 * Get total user count
 */
users.get('/admin/stats/users', requireAdmin, async (c) => {
  try {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return c.json({ error: 'Failed to get user count' }, 500);
    }

    return c.json({ count: count || 0 });
  } catch (error) {
    console.error('Stats error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /admin/stats/agents
 * Get total agent count
 */
users.get('/admin/stats/agents', requireAdmin, async (c) => {
  try {
    const { count, error } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return c.json({ error: 'Failed to get agent count' }, 500);
    }

    return c.json({ count: count || 0 });
  } catch (error) {
    console.error('Stats error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /admin/stats/credits
 * Get total credits used
 */
users.get('/admin/stats/credits', requireAdmin, async (c) => {
  try {
    // Total credits allocated
    const { data: totalData } = await supabase
      .from('credits')
      .select('balance');
    
    const totalAllocated = totalData?.reduce((sum, c) => sum + c.balance, 0) || 0;
    const initialAllocation = 75000 * (totalData?.length || 0);
    const used = initialAllocation - totalAllocated;

    return c.json({ 
      total_allocated: totalAllocated,
      used: Math.max(0, used)
    });
  } catch (error) {
    console.error('Stats error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /admin/users
 * List all users with their credit balances and agent counts
 */
users.get('/admin/users', requireAdmin, async (c) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, created_at');

    if (error) {
      return c.json({ error: 'Failed to get users' }, 500);
    }

    // Enrich each user with credits and agent count
    const enrichedUsers = await Promise.all(
      (users || []).map(async (user) => {
        const { data: credits } = await supabase
          .from('credits')
          .select('balance')
          .eq('user_id', user.id)
          .single();

        const { count } = await supabase
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', user.id);

        return {
          ...user,
          credits_balance: credits?.balance ?? 0,
          agent_count: count || 0
        };
      })
    );

    return c.json(enrichedUsers);
  } catch (error) {
    console.error('Get users error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /admin/audit/recent
 * Get recent audit log entries
 */
users.get('/admin/audit/recent', requireAdmin, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    
    const { data: logs, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      return c.json({ error: 'Failed to get audit log' }, 500);
    }

    return c.json(logs || []);
  } catch (error) {
    console.error('Audit error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export { users };
