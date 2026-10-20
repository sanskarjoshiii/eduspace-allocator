import { describe, expect, it } from 'vitest';
import { renderTemplate } from '@/server/notifications/render';
import { placeholdersOf } from '@/server/services/templates';

describe('renderTemplate', () => {
  it('replaces placeholders, tolerating spaces inside the braces', () => {
    expect(renderTemplate('Hi {{name}}, {{ courseTitle }} starts {{startDate}}.', { name: 'Asha', courseTitle: 'Python Basics', startDate: '01 Nov 2026' }))
      .toBe('Hi Asha, Python Basics starts 01 Nov 2026.');
  });

  it('renders numbers and zero', () => {
    expect(renderTemplate('{{seatsTaken}} of {{batchSize}} seats', { seatsTaken: 0, batchSize: 20 })).toBe('0 of 20 seats');
  });

  it('renders unknown, null and undefined placeholders as empty strings', () => {
    expect(renderTemplate('[{{missing}}][{{nil}}][{{undef}}]', { nil: null, undef: undefined })).toBe('[][][]');
  });

  it('repeats a placeholder and leaves text without placeholders alone', () => {
    expect(renderTemplate('{{a}}-{{a}}', { a: 'x' })).toBe('x-x');
    expect(renderTemplate('No placeholders here', {})).toBe('No placeholders here');
  });

  it('does not evaluate malformed placeholders', () => {
    expect(renderTemplate('{{ bad-key }} {single}', { 'bad-key': 'x', single: 'y' })).toBe('{{ bad-key }} {single}');
  });

  it('lists placeholders in first-seen order without duplicates', () => {
    expect(placeholdersOf('{{courseTitle}} at {{spaceName}}', '{{spaceName}}, {{ session }}')).toEqual(['courseTitle', 'spaceName', 'session']);
  });
});
