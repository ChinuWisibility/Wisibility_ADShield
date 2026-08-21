import {
  applyColumnOrder,
  buildAccountTableColumnDefs,
  buildAdLdapColumnDefs,
  fieldHasDataInUsers,
  formatAccountStatusDisplay,
  isExplicitSourceMapping,
  mergeColumnOrderKeys,
  moveColumnKeyInOrder,
  parseMemberOfEntitlements,
} from './accountTableColumns.js';

describe('accountTableColumns', () => {
  const templateMappings = [
    { standardField: 'user_id', csvColumn: 'user_id', isPrimaryKey: true },
    { standardField: 'employee_id', csvColumn: 'employee_id' },
    { standardField: 'telephone', csvColumn: 'telephone' },
    {
      standardField: 'status',
      csvColumn: 'userAccountControl',
      displayName: 'Status',
    },
    { standardField: 'email', csvColumn: 'mail' },
  ];

  const sampleUsers = [
    {
      user_id: 'jack.saad',
      email: 'jack@example.com',
      status: '512',
      department: 'Legal',
    },
  ];

  test('hides empty template columns without LDAP mapping or data', () => {
    expect(isExplicitSourceMapping(templateMappings[1])).toBe(false);
    expect(isExplicitSourceMapping(templateMappings[3])).toBe(true);
    expect(fieldHasDataInUsers(sampleUsers, 'email')).toBe(true);
    expect(fieldHasDataInUsers(sampleUsers, 'telephone')).toBe(false);
  });

  test('buildAccountTableColumnDefs returns only data-backed columns', () => {
    const defs = buildAccountTableColumnDefs({
      userMappings: templateMappings,
      users: sampleUsers,
    });
    const keys = defs.map((d) => d.key);
    expect(keys).toContain('user_id');
    expect(keys).toContain('email');
    expect(keys).not.toContain('employee_id');
    expect(keys).not.toContain('telephone');
  });

  test('formatAccountStatusDisplay normalizes UAC 512', () => {
    expect(formatAccountStatusDisplay('512').label).toBe('Active');
    expect(formatAccountStatusDisplay('514').label).toBe('Disabled');
  });

  test('parseMemberOfEntitlements extracts CN from DN', () => {
    const parsed = parseMemberOfEntitlements(
      'CN=GRP_IT_Admin,OU=Groups,DC=example; CN=Finance,OU=Groups',
    );
    expect(parsed.displayItems[0]).toBe('GRP_IT_Admin');
    expect(parsed.displayItems[1]).toBe('Finance');
  });

  test('buildAdLdapColumnDefs uses LDAP attribute names not Wisibility standard fields', () => {
    const adUsers = [
      {
        user_id: 'jack.saad',
        display_name: 'Jack',
        email: 'jack@example.com',
        sAMAccountName: 'jack.saad',
        mail: 'jack@example.com',
        displayName: 'Jack Saad',
        department: 'Legal',
        userAccountControl: '512',
        memberOf: ['CN=GRP_IT,OU=Groups,DC=corp'],
      },
    ];
    const defs = buildAccountTableColumnDefs({
      userMappings: templateMappings,
      users: adUsers,
      isAdConnector: true,
    });
    const keys = defs.map((d) => d.key);
    const labels = defs.map((d) => d.label);
    expect(keys).toContain('sAMAccountName');
    expect(keys).toContain('mail');
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('display_name');
    expect(labels).toContain('sAMAccountName');
    expect(labels).not.toContain('User Id');
  });

  test('mergeColumnOrderKeys keeps saved order and appends new keys', () => {
    expect(mergeColumnOrderKeys(['mail', 'title'], ['title', 'mail', 'sn'])).toEqual([
      'mail',
      'title',
      'sn',
    ]);
  });

  test('moveColumnKeyInOrder swaps adjacent keys', () => {
    const order = ['a', 'b', 'c'];
    expect(moveColumnKeyInOrder(order, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveColumnKeyInOrder(order, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  test('applyColumnOrder sorts defs by key list', () => {
    const defs = [
      { key: 'mail', label: 'mail' },
      { key: 'sn', label: 'sn' },
    ];
    expect(applyColumnOrder(defs, ['sn', 'mail']).map((d) => d.key)).toEqual(['sn', 'mail']);
  });

  test('buildAdLdapColumnDefs discovers attrs from nested rawData', () => {
    const defs = buildAdLdapColumnDefs([
      {
        user_id: 'u1',
        rawData: { employeeNumber: 'E-99', title: 'Engineer' },
      },
    ]);
    expect(defs.map((d) => d.key)).toEqual(
      expect.arrayContaining(['employeeNumber', 'title']),
    );
  });
});
