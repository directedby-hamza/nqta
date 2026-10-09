// A sign-in number is a username, not evidence of ownership of that phone.
export function normaliseCustomerLoginPhone(value: string): string {
  if (typeof value !== 'string' || value.length > 100)
    throw new Error('Enter a valid phone number, for example 0612345678 or +212612345678.');
  const compact = value.replace(/[\s()-]/g, '');
  const phone = /^0[67]\d{8}$/.test(compact) ? `+212${compact.slice(1)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error('Enter a valid phone number, for example 0612345678 or +212612345678.');
  return phone;
}
