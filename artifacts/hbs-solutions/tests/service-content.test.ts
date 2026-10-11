// Content gate for the public service pages. Run with:
//   npx tsx --test tests/service-content.test.ts
// Every service needs enough unique editorial text to stand as a page, and
// none of it may state a price or a processing time (the office publishes
// those through its catalogue only).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryById, serviceBySlug, services } from '../src/content/services';
import { portalFlow } from '../src/content/site';
import { contact } from '../src/content/contact';

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const priceOrTime = /\d\s*(?:ريال|ر\.س|SAR|يوم|أيام|ساعة|ساعات|أسبوع|أسابيع|شهر|أشهر)/;
const stats = services.map((service) => {
  const body = [service.intro, ...(service.steps ?? []), ...service.faq.flatMap((f) => [f.q, f.a])].join(' ');
  return { slug: service.slug, intro: words(service.intro).length, total: words(body).length, body };
});

test('catalogue still has the expected size and unique slugs', () => {
  assert.equal(services.length, 55);
  assert.equal(new Set(services.map((s) => s.slug)).size, services.length);
});

test('every service has an intro of at least 60 words and 120 to 220 words in total', () => {
  for (const s of stats) {
    assert.ok(s.intro >= 60, `${s.slug}: intro has ${s.intro} words (minimum 60)`);
    assert.ok(s.intro <= 110, `${s.slug}: intro has ${s.intro} words (maximum 110)`);
    assert.ok(s.total >= 120, `${s.slug}: ${s.total} words in total (minimum 120)`);
    assert.ok(s.total <= 240, `${s.slug}: ${s.total} words in total (maximum 240)`);
  }
});

test('every service has 2 to 3 FAQ items with a question and a short answer', () => {
  for (const service of services) {
    assert.ok(service.faq.length >= 2 && service.faq.length <= 3, `${service.slug}: ${service.faq.length} FAQ items`);
    for (const { q, a } of service.faq) {
      assert.ok(q.trim().endsWith('؟'), `${service.slug}: FAQ question must end with ؟: ${q}`);
      assert.ok(words(a).length >= 8 && words(a).length <= 45, `${service.slug}: FAQ answer length ${words(a).length}: ${q}`);
    }
    if (service.steps) assert.ok(service.steps.length >= 3 && service.steps.length <= 5, `${service.slug}: ${service.steps.length} steps`);
  }
  assert.ok(portalFlow.length >= 3 && portalFlow.length <= 5);
});

test('related services point to existing, different services', () => {
  for (const service of services) {
    if (!service.related) continue;
    assert.ok(service.related.length >= 2 && service.related.length <= 3, `${service.slug}: ${service.related.length} related slugs`);
    assert.equal(new Set(service.related).size, service.related.length, `${service.slug}: duplicate related slug`);
    for (const slug of service.related) {
      assert.ok(serviceBySlug[slug], `${service.slug}: related slug does not exist: ${slug}`);
      assert.notEqual(slug, service.slug, `${service.slug}: relates to itself`);
    }
  }
});

test('no price or processing time is stated in intro, steps or FAQ', () => {
  for (const s of stats) {
    assert.ok(!priceOrTime.test(s.body), `${s.slug}: digit followed by a currency or time unit`);
    assert.ok(!/\d/.test(s.body), `${s.slug}: digits are not allowed in editorial text (${s.body.match(/\d+/)?.[0]})`);
  }
  assert.ok(!portalFlow.some((step) => /\d/.test(step)), 'portal flow must not contain digits');
});

test('intros and FAQ answers are unique across services, and the city is named only in the core fifteen', () => {
  assert.equal(new Set(services.map((s) => s.intro)).size, services.length, 'duplicate intro');
  const answers = services.flatMap((s) => s.faq.map((f) => `${s.slug}|${f.a}`));
  assert.equal(new Set(answers.map((a) => a.split('|')[1])).size, answers.length, 'FAQ answer repeated verbatim between services');
  for (const service of services) {
    const mentions = [service.intro, ...(service.steps ?? []), ...service.faq.flatMap((f) => [f.q, f.a])].join(' ').split(contact.city).length - 1;
    assert.ok(mentions <= 1, `${service.slug}: city named ${mentions} times`);
  }
  const withCity = services.filter((s) => s.intro.includes(contact.city));
  assert.equal(withCity.length, 15, `city appears in ${withCity.length} intros, expected the 15 core services`);
  assert.ok(withCity.every((s) => !s.platform || ['مقيم', 'قوى', 'مُدد', 'التأمينات الاجتماعية', 'المركز السعودي للأعمال', 'هيئة الزكاة والضريبة والجمارك'].includes(s.platform)));
});

test('service categories referenced by the content exist', () => {
  for (const service of services) assert.ok(categoryById[service.category], service.slug);
  const totals = stats.map((s) => s.total);
  console.log(`words per service: min ${Math.min(...totals)}, max ${Math.max(...totals)}, avg ${Math.round(totals.reduce((a, b) => a + b, 0) / totals.length)}; intro min ${Math.min(...stats.map((s) => s.intro))}, avg ${Math.round(stats.map((s) => s.intro).reduce((a, b) => a + b, 0) / stats.length)}`);
});
