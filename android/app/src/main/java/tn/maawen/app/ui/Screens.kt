package tn.maawen.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tn.maawen.app.UiState
import tn.maawen.app.data.ChatLine
import tn.maawen.app.data.PlanInfo
import tn.maawen.app.data.ToolInfo

// ═══════════════════════════════════════════════════════════ connexion ════

@Composable
fun LoginScreen(onSignIn: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🤖", fontSize = 64.sp)
        Spacer(Modifier.height(16.dp))
        Text("المعاون", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "مساعدك الشخصي بالصوت — احكي بالتونسي وهو يتصرّف.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(40.dp))
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text("ادخل بحساب Google", fontSize = 16.sp)
        }
    }
}

// ═════════════════════════════════════════════════════════════ le chat ════

@Composable
fun ChatScreen(
    state: UiState,
    onSend: (String) -> Unit,
    onMic: () -> Unit,
    onStopMic: () -> Unit,
    onOpenApps: () -> Unit,
    onOpenPlans: () -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(state.lines.size) {
        if (state.lines.isNotEmpty()) listState.animateScrollToItem(state.lines.size - 1)
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(state, onOpenApps, onOpenPlans)

        state.pendingApps.takeIf { it.isNotEmpty() }?.let { pending ->
            Banner(
                text = "فمّا ${pending.size} تطبيق جديد يستنّى موافقتك.",
                action = "شوفهم",
                onAction = onOpenApps,
            )
        }
        state.blockedReason?.let { Banner(blockedText(it), "اشترك", onOpenPlans) }
        state.message?.let { Banner(it, null) {} }

        Box(Modifier.weight(1f)) {
            if (state.lines.isEmpty()) {
                EmptyChat()
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(state.lines) { line -> Bubble(line) }
                }
            }
        }

        if (state.listening) {
            ListeningBar(state.partial, onStopMic)
        } else {
            Composer(
                draft = draft,
                thinking = state.thinking,
                onDraft = { draft = it },
                onSend = {
                    onSend(draft)
                    draft = ""
                },
                onMic = onMic,
            )
        }
    }
}

@Composable
private fun TopBar(state: UiState, onOpenApps: () -> Unit, onOpenPlans: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("المعاون", fontWeight = FontWeight.Bold)
                Text(
                    if (state.subscription.isActive) {
                        "${state.subscription.creditsRemaining} كريدي باقي"
                    } else {
                        "ما فماش اشتراك نشط"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onOpenApps) { Text("التطبيقات") }
            TextButton(onClick = onOpenPlans) { Text("الاشتراك") }
        }
    }
}

@Composable
private fun EmptyChat() {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🤖", fontSize = 52.sp)
        Spacer(Modifier.height(12.dp))
        Text("شنوة نعملك؟", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(6.dp))
        Text(
            "«ذكّرني غدوة مع 10 نكلم محمد» · «شنوة عندي اليوم؟» · «ابعث لسامي رسالة»",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Bubble(line: ChatLine) {
    val isUser = line.fromUser
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.Start else Arrangement.End,
    ) {
        Surface(
            color = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth(0.88f),
        ) {
            Column(Modifier.padding(12.dp)) {
                if (line.text.isNotBlank()) Text(line.text)
                if (line.tools.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        line.tools.joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun Composer(
    draft: String,
    thinking: Boolean,
    onDraft: (String) -> Unit,
    onSend: () -> Unit,
    onMic: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .clickable(enabled = !thinking, onClick = onMic),
                contentAlignment = Alignment.Center,
            ) {
                Text("🎙️", fontSize = 24.sp)
            }

            OutlinedTextField(
                value = draft,
                onValueChange = onDraft,
                modifier = Modifier.weight(1f),
                placeholder = { Text("ولا اكتب هوني…") },
                singleLine = true,
                enabled = !thinking,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
            )

            if (thinking) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
            } else {
                TextButton(onClick = onSend, enabled = draft.isNotBlank()) { Text("ابعث") }
            }
        }
    }
}

@Composable
private fun ListeningBar(partial: String, onStop: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.primaryContainer) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(partial.ifBlank { "نسمع فيك…" }, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = onStop) { Text("وقّف") }
        }
    }
}

@Composable
private fun Banner(text: String, action: String?, onAction: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            if (action != null) TextButton(onClick = onAction) { Text(action) }
        }
    }
}

private fun blockedText(reason: String): String = when (reason) {
    "no_credits" -> "الكريدي متاعك سالى. جدّد الاشتراك باش تكمّل."
    "daily_cap" -> "وصلت للحدّ متاع النهار. عاود غدوة ولا رفّع الاشتراك."
    "blocked" -> "الحساب متاعك موقّف. اتصل بينا."
    else -> "باش تستعمل المعاون، لازمك اشتراك."
}

// ═══════════════════════════════════════════════════════════ les apps ════

@Composable
fun AppsScreen(tools: List<ToolInfo>, onBack: () -> Unit, onToggle: (ToolInfo, Boolean) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("التطبيقات متاع المعاون", onBack)
        Text(
            "أنت اللي تقرّر: كل تطبيق ما يخدمش قبل ما تسمحلو، وتنجّم تطفّيه وقت ما تحب.",
            Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(tools) { tool ->
                Card {
                    Row(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(tool.icon.ifBlank { "•" }, fontSize = 24.sp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(tool.name, fontWeight = FontWeight.SemiBold)
                            Text(
                                tool.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (tool.minPlan != null) {
                                Text(
                                    "يلزم اشتراك ${tool.minPlan}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                        if (tool.requiresConsent) {
                            Switch(checked = tool.granted, onCheckedChange = { onToggle(tool, it) })
                        } else {
                            Text("ديما", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}

// ══════════════════════════════════════════════════════════ abonnement ════

@Composable
fun PlansScreen(
    state: UiState,
    onBack: () -> Unit,
    onSubscribe: (PlanInfo, String) -> Unit,
    onSignOut: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("الاشتراك", onBack)

        Card(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text(
                    if (state.subscription.isActive) "اشتراك ${state.subscription.plan} نشط" else "ما فماش اشتراك",
                    fontWeight = FontWeight.Bold,
                )
                if (state.subscription.isActive) {
                    Text(
                        "${state.subscription.creditsRemaining} كريدي باقي" +
                            (state.subscription.periodEnd?.take(10)?.let { " · يسالي $it" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(state.plans) { plan ->
                Card {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(plan.name, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                            Text("${plan.priceDt.toInt()} د.ت / شهر", color = MaterialTheme.colorScheme.primary)
                        }
                        Text(
                            "${plan.description} · ${plan.credits} طلب في الشهر",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { onSubscribe(plan, "flouci") }, modifier = Modifier.weight(1f)) {
                                Text("خلّص بالدينار")
                            }
                            OutlinedButton(onClick = { onSubscribe(plan, "stripe") }, modifier = Modifier.weight(1f)) {
                                Text("Carte / \$${plan.priceUsd.toInt()}")
                            }
                        }
                    }
                }
            }
            item {
                TextButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("اخرج من الحساب") }
            }
        }
    }
}

@Composable
private fun ScreenHeader(title: String, onBack: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("رجوع") }
            Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold)
        }
    }
}
