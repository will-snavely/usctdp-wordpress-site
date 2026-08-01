# Request to Enable Vaulted Payments for Recurring Program Registration

**USC Tennis Development Program**
Belong · Become · Believe
tennis@usctdp.com · (412) 831-2630

**Prepared for:** PayPal Merchant Risk & Payments Review
**Subject:** Vaulted Payments Enablement
**Document:** Proposal · Rev. 1

A proposal to extend our existing PayPal merchant account with stored-payment-method
capability, for both customer self-service and staff-assisted registration.

## 1. Who we are

USC Tennis Development Program is a youth and adult tennis instruction business operating
tennis clinics, camps, and lessons on a recurring seasonal schedule throughout the year.
Families and individual members enroll repeatedly across sessions - the same structure as a
gym membership, a swim school, or a camp program, where a returning customer re-registers for
the next available session rather than making a single one-time purchase.

- **Account age:** ~5 years *(TODO: confirm exact tenure)*
- **Annual processing volume:** $100K-$999K *(TODO: pull real figures from PayPal Activity Reports, by year)*

## 2. Why vaulting fits this business

Because enrollment is recurring rather than one-time, customers regularly re-enter the same
payment details each new session. A stored payment method removes that friction for returning
families, and lets our office complete a registration on a customer's behalf when they call or
visit in person - a common request during our busiest enrollment periods.

## 3. Two payment flows

We are requesting support for both of the following, built on WooCommerce's standard
payment-token integration with PayPal:

**Customer-Initiated** - A returning customer logs into their account and completes checkout
themselves, using a payment method saved from a prior order.

**Merchant-Initiated** - Office staff complete a registration the customer has explicitly
requested by phone or in person, charging the payment method already on file.

The second flow is a merchant-initiated transaction against a stored credential, and is the
capability that specifically requires this request - it is addressed directly by the consent
model below.

## 4. Customer consent

Payment information is only stored with the customer's explicit, affirmative consent, captured
at the time the payment method is saved. The authorization is presented in plain language, not
buried in general terms:

> "I authorize USCTDP to securely store my payment method and charge it for future
> registrations I request by phone, email, or in person, until I revoke this authorization."

This same commitment is published on our site's policies page. Customers can view or remove a
saved payment method at any time from their account dashboard, or by contacting our office
directly - revocation is not gated behind any additional process.

## 5. Data handling

- Payment methods are held in PayPal's own vault - our systems never receive, transmit, or
  store a full card number, keeping our PCI DSS scope minimal by design.
- Our production environment runs on hardened, actively monitored infrastructure: key-only
  server access, host and network-level firewalls, automated intrusion lockout, and automatic
  security patching.
- All traffic is encrypted end-to-end, with browser-level protections against common web attack
  vectors.
- Every software release is automatically scanned for known vulnerabilities before it reaches
  production, and our platform and dependencies are kept current on an ongoing, monitored
  basis.
- Customer and order data is backed up nightly, with recovery verified end-to-end rather than
  assumed.

## 6. Refunds & disputes

Our published refund policy is narrow and predictable: refunds are issued for documented injury
or illness, with unused balances otherwise converted to a house credit valid for one year. This
policy is publicly posted and disclosed to every customer at enrollment, reducing the
likelihood of a saved-payment-method charge being unrecognized or disputed after the fact.

## 7. What we're requesting

**Enablement of vaulted/saved payment methods** on our existing PayPal merchant account,
integrated through WooCommerce PayPal Payments, covering both customer-initiated checkout with
a saved method and merchant-initiated charges against a stored credential with documented
customer consent.

We are happy to provide additional documentation, a live walkthrough of the consent and
checkout flow, or any further detail your review requires.

---

**Prepared by** - USC Tennis Development Program
**Date:** _____________
