<script setup lang="ts">
import { T, useTranslations } from "@lingua-api/vue-i18n";

const t = useTranslations();
const name = "Ada";
</script>

<template>
  <nav>
    <a href="/">{{ $t("nav.home") }}</a>
  </nav>
  <main>
    <h1>{{ t("Hello {name}", { name }) }}</h1>
    <p>{{ t("one message | {count} messages", { count: 3 }) }}</p>
    <p>{{ $t("cart", 2) }}</p>
    <p><T message="Welcome back, {name}" :values="{ name }" /></p>
  </main>
</template>
