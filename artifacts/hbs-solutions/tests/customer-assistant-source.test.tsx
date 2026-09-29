// @ts-nocheck
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  resolve: { dedupe: ['react'] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['wouter'] },
  plugins: [{
    name: 'assistant-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@workspace/api-client-react') return '\0assistant-api';
      if (id === 'wouter') return '\0assistant-router';
    },
    load(id) {
      if (id === '\0assistant-api') return 'export const useAnswerCustomerInquiry = () => globalThis.__assistantMutation;';
      if (id === '\0assistant-router') return 'import React from "react"; export const Link = ({children, href, ...props}) => React.createElement("a", {href, ...props}, children);';
    },
  }],
  server: { middlewareMode: true },
  appType: 'custom',
});
after(async () => server.close());
const { CustomerAssistant } = await server.ssrLoadModule('/src/components/customer-assistant.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
async function mount(response) {
  const questions = [];
  let officeCalls = 0;
  globalThis.__assistantMutation = {
    isPending: false,
    isError: false,
    mutateAsync: async input => {
      questions.push(input);
      return response;
    },
  };
  let tree;
  await act(async () => {
    tree = renderer.create(<CustomerAssistant onAskOffice={() => { officeCalls++; }} />);
  });
  return {
    tree,
    questions,
    officeCalls: () => officeCalls,
    async ask(question) {
      await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: question } }));
      await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    },
  };
}

test('assistant renders public citation titles after asking, not extra private response fields', async () => {
  const app = await mount({
    answer: 'أحضر نسخة من الوثيقة.',
    needsOffice: false,
    sources: [{
      id: 12,
      title: 'متطلبات التجديد',
      reviewedAt: 'SECRET_REVIEW_DATE',
      publishedAt: 'SECRET_PUBLISH_DATE',
      draftContent: 'SECRET_PRIVATE_DRAFT',
      officeNote: 'SECRET_OFFICE_NOTE',
      customerId: 'SECRET_CUSTOMER_ID',
    }],
  });
  try {
    await app.ask('  ما متطلبات التجديد؟  ');
    assert.deepEqual(app.questions, [{ data: { question: 'ما متطلبات التجديد؟' } }]);
    const answer = app.tree.root.findByProps({ 'aria-live': 'polite' });
    assert.match(text(answer), /ما متطلبات التجديد؟/);
    assert.match(text(answer), /أحضر نسخة من الوثيقة/);
    assert.match(text(answer), /المعلومات المعتمدة:/);
    assert.match(text(answer), /متطلبات التجديد/);
    for (const secret of ['SECRET_REVIEW_DATE', 'SECRET_PUBLISH_DATE', 'SECRET_PRIVATE_DRAFT', 'SECRET_OFFICE_NOTE', 'SECRET_CUSTOMER_ID']) {
      assert.ok(!text(app.tree.root).includes(secret), `Rendered private field ${secret}`);
    }
    const handoff = answer.findAllByType('button').find(button => text(button).includes('أرسل استفسارًا للمكتب'));
    await act(async () => handoff.props.onClick());
    assert.equal(app.officeCalls(), 1);
  } finally {
    await act(async () => app.tree.unmount());
  }
});

test('assistant offers office handoff but no citation label when the answer has no sources', async () => {
  const app = await mount({ answer: 'يرجى سؤال المكتب.', needsOffice: true, sources: [] });
  try {
    await app.ask('ما حالة طلبي؟');
    const answer = app.tree.root.findByProps({ 'aria-live': 'polite' });
    assert.match(text(answer), /يرجى سؤال المكتب/);
    assert.doesNotMatch(text(answer), /المعلومات المعتمدة:/);
    assert.match(text(answer), /أرسل استفسارًا للمكتب/);
  } finally {
    await act(async () => app.tree.unmount());
  }
});

test('assistant clears an old answer on a failed new question and retries without stale citations', async () => {
  const oldQuestion = 'كيف أجد متطلبات التجديد؟';
  const retryQuestion = 'كيف أتابع الطلب الجديد؟';
  const oldAnswer = 'OLD_ANSWER_DETAILS';
  const oldSource = 'OLD_SOURCE_TITLE';
  const app = await mount({
    answer: oldAnswer,
    needsOffice: false,
    sources: [{ id: 12, title: oldSource }],
  });
  try {
    await app.ask(oldQuestion);
    assert.match(text(app.tree.root.findByProps({ 'aria-live': 'polite' })), /OLD_SOURCE_TITLE/);

    let rejectRequest;
    const failedRequest = new Promise((_, reject) => { rejectRequest = reject; });
    const mutation = globalThis.__assistantMutation;
    mutation.mutateAsync = async input => {
      app.questions.push(input);
      return failedRequest;
    };
    await act(async () => app.tree.root.findByType('textarea').props.onChange({ target: { value: retryQuestion } }));
    let submission;
    await act(async () => {
      submission = app.tree.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    assert.equal(app.tree.root.findAllByProps({ 'aria-live': 'polite' }).length, 0);
    assert.equal(app.tree.root.findByType('textarea').props.value, retryQuestion);
    for (const stale of [oldQuestion, oldAnswer, oldSource, 'المعلومات المعتمدة:']) {
      assert.ok(!text(app.tree.root).includes(stale), `Old result remained while requesting: ${stale}`);
    }

    await act(async () => {
      rejectRequest(new Error('Service unavailable'));
      await submission;
      mutation.isError = true;
      mutation.error = new Error('Service unavailable');
      app.tree.update(<CustomerAssistant onAskOffice={() => {}} />);
    });
    assert.equal(app.tree.root.findByType('textarea').props.value, retryQuestion);
    assert.match(text(app.tree.root.findByProps({ role: 'alert' })), /تعذّر الحصول على إجابة الآن. حاول مرة أخرى أو أرسل استفسارًا للمكتب./);
    assert.equal(app.tree.root.findAllByProps({ 'aria-live': 'polite' }).length, 0);
    for (const stale of [oldQuestion, oldAnswer, oldSource]) {
      assert.ok(!text(app.tree.root).includes(stale), `Old result remained after failure: ${stale}`);
    }

    mutation.mutateAsync = async input => {
      app.questions.push(input);
      mutation.isError = false;
      return { answer: 'NEW_ANSWER_DETAILS', needsOffice: false, sources: [{ id: 34, title: 'NEW_SOURCE_TITLE' }] };
    };
    await app.ask(retryQuestion);
    await act(async () => app.tree.update(<CustomerAssistant onAskOffice={() => {}} />));
    assert.deepEqual(app.questions, [
      { data: { question: oldQuestion } },
      { data: { question: retryQuestion } },
      { data: { question: retryQuestion } },
    ]);
    const answer = app.tree.root.findByProps({ 'aria-live': 'polite' });
    assert.match(text(answer), /NEW_ANSWER_DETAILS/);
    assert.match(text(answer), /NEW_SOURCE_TITLE/);
    assert.match(text(answer), /كيف أتابع الطلب الجديد؟/);
    assert.equal(app.tree.root.findByType('textarea').props.value, '');
    assert.equal(app.tree.root.findAllByProps({ role: 'alert' }).length, 0);
    for (const stale of [oldQuestion, oldAnswer, oldSource]) {
      assert.ok(!text(app.tree.root).includes(stale), `Old result remained after retry: ${stale}`);
    }
  } finally {
    await act(async () => app.tree.unmount());
  }
});