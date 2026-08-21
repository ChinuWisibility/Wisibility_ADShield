import { IAMClient, ListUsersCommand } from '@aws-sdk/client-iam';

export function normalizeAwsConfig(input = {}) {
  return {
    accessKeyId: String(input.accessKeyId ?? input.awsAccessKeyId ?? '').trim(),
    secretAccessKey: String(input.secretAccessKey ?? input.awsSecretAccessKey ?? '').trim(),
    region: String(input.region ?? input.awsRegion ?? 'us-east-1').trim(),
  };
}

export async function testAwsIamConnection(raw) {
  const cfg = normalizeAwsConfig(raw);
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('AWS access key ID and secret access key are required.');
  }
  const client = new IAMClient({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  const out = await client.send(new ListUsersCommand({ MaxItems: 1 }));
  return {
    ok: true,
    sampleCount: out.Users?.length ?? 0,
    hint: 'IAM ListUsers succeeded.',
  };
}

export async function fetchAwsIamUsers(raw, options = {}) {
  const cfg = normalizeAwsConfig(raw);
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('AWS access key ID and secret access key are required.');
  }
  const maxUsers = Math.min(Math.max(parseInt(options.maxUsers, 10) || 10000, 1), 50000);
  const client = new IAMClient({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  const users = [];
  let marker;
  do {
    const out = await client.send(
      new ListUsersCommand({ Marker: marker, MaxItems: Math.min(100, maxUsers - users.length) })
    );
    for (const u of out.Users || []) {
      users.push({
        user_id: u.UserName || u.UserId || '',
        employee_id: u.Arn || '',
        username: u.UserName || '',
        email: '',
        display_name: u.UserName || '',
        status: 'active',
        department: '',
        title: '',
        manager_id: '',
        telephone: '',
        member_of_entitlements: '',
        rawData: u,
      });
      if (users.length >= maxUsers) break;
    }
    marker = out.IsTruncated ? out.Marker : undefined;
  } while (marker && users.length < maxUsers && marker);
  return users;
}
