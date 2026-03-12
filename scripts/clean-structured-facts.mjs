#!/usr/bin/env node
/**
 * 清洗 structured-facts-aggregated.json 中的错误数据
 *
 * 主要问题：
 * 1. "中国"被当成海外目的地
 * 2. "印度"的证据来自尼泊尔签证攻略
 * 3. 马拉松赛事大量重复
 * 4. 阅读总数100本来自东极岛游记
 * 5. 部分证据链接不匹配
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, '../data/structured-facts-aggregated.json');
const outputPath = path.join(__dirname, '../data/structured-facts-aggregated.json');

console.log('📖 读取原始数据...');
const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

// 1. 清洗旅行数据
console.log('\n🧹 清洗旅行数据...');
const cleanedCountries = rawData.travel.countries.filter(country => {
  // 移除"中国"（不应作为海外目的地）
  if (country.name === '中国') {
    console.log(`  ❌ 移除: ${country.name} (不应作为海外目的地)`);
    return false;
  }

  // 移除"印度"（证据来自尼泊尔签证攻略，明显错误）
  if (country.name === '印度') {
    const hasNepalVisaEvidence = country.evidence?.some(e =>
      e.url.includes('ni-bo-er-qian-zheng')
    );
    if (hasNepalVisaEvidence) {
      console.log(`  ❌ 移除: ${country.name} (证据来自尼泊尔签证攻略)`);
      return false;
    }
  }

  return true;
});

// 清洗尼泊尔的错误证据
const cleanedCountriesWithEvidence = cleanedCountries.map(country => {
  if (country.name === '尼泊尔') {
    const validEvidence = country.evidence?.filter(e => {
      // 只保留真正的尼泊尔游记
      const isValid = e.url.includes('nepal') || e.url.includes('ni-bo-er');
      if (!isValid) {
        console.log(`  🔧 移除尼泊尔的无关证据: ${e.title}`);
      }
      return isValid;
    });
    return { ...country, evidence: validEvidence };
  }
  return country;
});

rawData.travel.countries = cleanedCountriesWithEvidence;

// 2. 清洗马拉松数据（去重）
console.log('\n🧹 清洗马拉松数据...');
const seenRaces = new Map();
const cleanedRaces = [];

for (const race of rawData.races.completedEvents) {
  // 生成唯一键：赛事名 + 日期
  const normalizedName = race.name
    .replace(/^\d{4}/, '') // 移除年份前缀
    .replace(/国际/, '')
    .replace(/马拉松$/, '')
    .trim();

  const normalizedDate = race.date?.replace(/年$/, '').replace(/-\d{2}-\d{2}$/, '');
  const key = `${normalizedName}-${normalizedDate}`;

  if (seenRaces.has(key)) {
    console.log(`  ❌ 移除重复: ${race.name} (${race.date})`);
    continue;
  }

  // 过滤掉明显错误的条目
  if (race.result === '未提及') {
    console.log(`  ❌ 移除无效记录: ${race.name} (成绩未提及)`);
    continue;
  }

  // 过滤掉非全马赛事（如10KM）
  if (race.name.includes('10KM') || race.name.includes('10km')) {
    console.log(`  ❌ 移除非全马: ${race.name}`);
    continue;
  }

  seenRaces.set(key, true);
  cleanedRaces.push(race);
}

rawData.races.completedEvents = cleanedRaces;
console.log(`  ✅ 保留 ${cleanedRaces.length} 场马拉松记录`);

// 3. 清洗阅读数据
console.log('\n🧹 清洗阅读数据...');
if (rawData.reading?.lifetimeReadCount) {
  const readCount = rawData.reading.lifetimeReadCount;

  // 检查来源是否是东极岛游记
  if (readCount.sourceUrl?.includes('dongji-island')) {
    console.log(`  ❌ 移除错误的阅���总数: ${readCount.value}本 (来源: ${readCount.sourceTitle})`);
    delete rawData.reading.lifetimeReadCount;
  }
}

// 4. 为所有数据添加 provenance 和 confidence
console.log('\n🏷️  添加 provenance 和 confidence 标记...');

// 旅行数据
rawData.travel.countries = rawData.travel.countries.map(country => ({
  ...country,
  provenance: 'auto_extracted',
  confidence: 'medium', // 自动提取，需人工验证
}));

rawData.travel.regions = rawData.travel.regions.map(region => ({
  ...region,
  provenance: 'auto_extracted',
  confidence: 'high', // 港澳台相对准确
}));

// 马拉松数据
rawData.races.completedEvents = rawData.races.completedEvents.map(race => ({
  ...race,
  provenance: 'auto_extracted',
  confidence: 'medium',
}));

// 阅读数据
if (rawData.reading?.roundupPosts) {
  rawData.reading.roundupPosts = rawData.reading.roundupPosts.map(post => ({
    ...post,
    provenance: 'auto_extracted',
    confidence: 'high', // 读书总结文章相对可靠
  }));
}

// 5. 更新元数据
rawData.cleanedAt = new Date().toISOString();
rawData.cleanedBy = 'scripts/clean-structured-facts.mjs';

// 6. 写入清洗后的数据
console.log('\n💾 写入清洗后的数据...');
fs.writeFileSync(outputPath, JSON.stringify(rawData, null, 2), 'utf-8');

console.log('\n✅ 清洗完成！');
console.log(`\n📊 统计：`);
console.log(`  - 海外国家: ${rawData.travel.countries.length} 个`);
console.log(`  - 港澳台: ${rawData.travel.regions.length} 个`);
console.log(`  - 马拉松: ${rawData.races.completedEvents.length} 场`);
console.log(`  - 阅读总结: ${rawData.reading?.roundupPosts?.length || 0} 篇`);
