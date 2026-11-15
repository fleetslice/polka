import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeEpub, makeTxt } from './fixtures';

async function addBook(page: Page, name = 'Айтматов - Белый пароход.epub'): Promise<void> {
  await page.goto('/cloud');
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/epub+zip', buffer: await makeEpub() });
  await expect(page.getByText(/Готово · на полке/)).toBeVisible({ timeout: 20_000 });
}

async function selectPhrase(page: Page, phrase: string): Promise<void> {
  await page.evaluate((needle) => {
    const root = document.querySelector('.book-text')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = (n.nodeValue ?? '').indexOf(needle);
      if (at >= 0) {
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + needle.length);
        const s = window.getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
    throw new Error('phrase not found');
  }, phrase);
}

test('пустая полка зовёт закинуть книгу', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /На полке пока пусто/ })).toBeVisible();
});

test('загрузка: книга встаёт на полку, дубликат и неподдерживаемый формат объясняются', async ({ page }) => {
  const epub = await makeEpub();
  await page.goto('/cloud');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Айтматов - Белый пароход.epub', mimeType: 'application/epub+zip', buffer: epub });
  await expect(page.getByText(/Готово · на полке/)).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'копия.epub', mimeType: 'application/epub+zip', buffer: epub },
    { name: 'старый.mobi', mimeType: 'application/octet-stream', buffer: Buffer.from('BOOKMOBI') },
    { name: 'рассказ.txt', mimeType: 'text/plain', buffer: makeTxt() },
  ]);
  await expect(page.getByText(/Уже на полке: «Белый пароход»/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Не получилось: Формат MOBI/)).toBeVisible();
  await expect(page.getByText(/Готово · на полке/)).toHaveCount(2);

  await page.goto('/');
  await expect(page.getByText('Личная библиотека · 2 книги')).toBeVisible();
  await expect(page.getByRole('link', { name: /Белый пароход/ })).toBeVisible();
  await page.getByRole('button', { name: 'Обложки' }).click();
  await expect(page.getByRole('link', { name: 'Читать: рассказ' })).toBeVisible();
});

test('полки: создать, переименовать, фильтровать', async ({ page }) => {
  await addBook(page);
  await page.goto('/');
  await page.getByRole('button', { name: '+ новая полка' }).click();
  await page.getByLabel('Название новой полки').fill('Проза');
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByText('На этой полке пока пусто')).toBeVisible();
  await page.getByRole('button', { name: 'Переименовать полку' }).click();
  await page.getByLabel('Новое название полки').fill('Повести');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: /^Повести/ })).toBeVisible();
});

test('чтение: прогресс по главе и книге, позиция переживает перезагрузку', async ({ page }) => {
  await addBook(page);
  await page.goto('/');
  await page.getByRole('link', { name: /Белый пароход/ }).first().click();
  await expect(page.locator('.book-text p').first()).toBeVisible();
  await expect(page.getByLabel('Оглавление и прогресс по главам').getByRole('button')).toHaveCount(3);

  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
  await expect(page.getByLabel(/Прочитано \d+ процентов книги/)).not.toHaveText('0%');
  const firstVisible = async (): Promise<number> => page.evaluate(() => document.querySelector<HTMLElement>('.book-text')!.parentElement!.parentElement!.parentElement!.scrollTop);
  const before = await firstVisible();
  expect(before).toBeGreaterThan(500);
  await page.waitForTimeout(900); // позиция сохраняется с задержкой

  await page.reload();
  await expect(page.locator('.book-text p').first()).toBeVisible();
  await expect.poll(firstVisible).toBeGreaterThan(before - 200);

  // Сегмент полосы ведёт к главе; T сворачивает сайдбар прогресса
  await page.getByRole('button', { name: /^Глава 3: / }).last().click();
  await expect(page.locator('header p.mono')).toContainText(/Глава 3/i);
  await page.keyboard.press('t');
  await expect(page.getByRole('complementary', { name: 'Прогресс' })).toBeHidden();

  await page.goto('/');
  await expect(page.getByText(/Продолжить · /)).toBeVisible();
});

test('цитата и заметка попадают в «Поля», клик возвращает в книгу', async ({ page }) => {
  await addBook(page);
  await page.goto('/reader');
  await expect(page.locator('.book-text p').first()).toBeVisible();
  await selectPhrase(page, 'старый бинокль деда Момуна');
  await page.getByRole('toolbar', { name: 'Действия с выделенным текстом' }).getByRole('button', { name: 'Цитата' }).click();
  await expect(page.locator('mark.hl-accent')).toHaveText('старый бинокль деда Момуна');

  await page.getByRole('tab', { name: /Заметки/ }).click();
  await page.getByLabel(/Новая заметка к стр/).fill('Бинокль — как окно в сказку #детство');
  await page.getByRole('button', { name: 'Сохранить заметку' }).click();
  await expect(page.getByRole('tab', { name: 'Заметки · 2' })).toBeVisible();

  await page.goto('/notes');
  await expect(page.getByText('«старый бинокль деда Момуна»')).toBeVisible();
  await expect(page.getByText('Бинокль — как окно в сказку')).toBeVisible();
  await page.getByRole('button', { name: '#детство' }).click();
  await expect(page.getByText('«старый бинокль деда Момуна»')).toBeHidden();
  await page.getByRole('button', { name: '#детство' }).click();

  await page.getByRole('link', { name: /Открыть это место в книге/ }).first().click();
  await expect(page.locator('mark.hl-accent')).toBeVisible();
});

test('две вкладки синхронизируются без перезагрузки', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await addBook(a);
  await b.goto('/');
  await expect(b.getByText('Личная библиотека · 1 книга')).toBeVisible();

  await a.goto('/reader');
  await expect(a.locator('.book-text p').first()).toBeVisible();
  await selectPhrase(a, 'старый бинокль деда Момуна');
  await a.getByRole('toolbar', { name: 'Действия с выделенным текстом' }).getByRole('button', { name: 'Цитата' }).click();
  for (let i = 0; i < 4; i += 1) {
    await a.keyboard.press('Space');
    await a.waitForTimeout(150);
  }
  // вкладка B видит прогресс и цитату, не перезагружаясь
  await expect(b.getByText(/Продолжить · /)).toBeVisible({ timeout: 10_000 });
  await b.getByRole('link', { name: '03 Заметки' }).click();
  await expect(b.getByText('«старый бинокль деда Момуна»')).toBeVisible();
});

test('без ключа ИИ вопрос к библиотеке показывает найденные места', async ({ page }) => {
  await addBook(page);
  await page.goto('/');
  await page.getByLabel('Вопрос к своим книгам и заметкам').fill('что за бинокль у деда');
  await page.getByRole('button', { name: 'Спросить' }).click();
  await expect(page.getByText(/ИИ не подключён/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Белый пароход · Глава 1/ }).first()).toBeVisible();
});

test('поиск Ctrl+K находит фразу в тексте книги', async ({ page }) => {
  await addBook(page);
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.getByLabel('Поиск', { exact: true }).fill('бинокль');
  await page.getByRole('dialog').getByRole('button', { name: /Белый пароход · Глава 1/ }).first().click();
  await expect(page).toHaveURL(/\/reader\?id=/);
  await expect(page.locator('mark.hl-find')).toBeVisible();

  // Ссылка на место в уже открытой книге тоже срабатывает: уходим в главу 3 и снова ищем фразу из главы 1
  await page.getByRole('button', { name: /^Глава 3: / }).last().click();
  await expect(page.locator('header p.mono')).toContainText(/Глава 3/i);
  await page.keyboard.press('Control+k');
  await page.getByLabel('Поиск', { exact: true }).fill('бинокль');
  await page.getByRole('dialog').getByRole('button', { name: /Белый пароход · Глава 1/ }).first().click();
  await expect(page.locator('header p.mono')).toContainText(/Глава 1/i);
  await expect(page.locator('mark.hl-find')).toBeVisible();
});

test('доступность: на экранах нет нарушений WCAG 2.1 AA (axe)', async ({ page }) => {
  await addBook(page);
  await page.goto('/reader');
  await expect(page.locator('.book-text p').first()).toBeVisible();
  await selectPhrase(page, 'старый бинокль деда Момуна');
  await page.getByRole('toolbar', { name: 'Действия с выделенным текстом' }).getByRole('button', { name: 'Цитата' }).click();
  await page.waitForTimeout(800);
  for (const path of ['/', '/reader', '/notes', '/book', '/cloud']) {
    await page.goto(path);
    await page.waitForTimeout(700);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map((v) => `${path}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  }
});

test('телефон: нижний таб-бар вместо меню', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Разделы' }).last();
  await expect(bar.getByRole('link')).toHaveText(['Полка', 'Заметки', 'ИИ', 'Облако']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
