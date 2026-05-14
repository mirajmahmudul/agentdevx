import { Hono } from 'hono';
import { supabase } from '../db.js';
import { signJWT } from '../auth/jwt.js';

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
    
    // We need to verify the JWT - for now we'll extract user_id from context
    // In production, you'd verify the JWT here
    const userId = c.get('userId'); // Set by middleware in index.ts
    
    if (!userId) {
      return c.json({ error: 'Invalid or missing token' }, 401);
    }

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
      credits_updated: credits?.updated_at
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
users.post('/admin/credits/topup', async (c) => {
  try {
    // Check admin authorization
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization header required' }, 401);
    }

    const token = authHeader.substring(7);
    const userRole = c.get('userRole'); // Set by middleware
    
    if (userRole !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

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

export { users };
