$file = 'C:\Users\leduc\OneDrive\Desktop\video-sum\src\chat-messages\chat-message.service.ts'
$content = Get-Content $file -Raw -Encoding UTF8

# generateAnswer - replace
$old1Start = '  private async generateAnswer(input: {'
$old1End = '    return this.buildFallbackAnswer(input);'
$new1 = @'
  private async generateAnswer(input: {
    question: string;
    session: ChatSessionContext;
    transcript: TranscriptRecord;
    summary: SummaryRecord;
    recentMessages: Array<{ role: string; content: string }>;
    retrievedChunks: RetrievedContext[];
  }): Promise<GeneratedAnswer> {
    if (!this.groqGateway.hasKeys()) {
      return this.buildFallbackAnswer(input);
    }

    const modelCandidates = this.buildAnswerModelCandidates();
    const primaryModel = modelCandidates[0];
    const fallbackModels = modelCandidates.slice(1);

    const result = await this.groqGateway.chatCompletion({
      model: primaryModel,
      fallbackModels,
      messages: this.buildAnswerMessages(input),
      maxTokens: 900,
    });

    if (!result) {
      return this.buildFallbackAnswer(input);
    }

    return {
      content: result.content,
      modelUsed: result.modelUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }
'@

# generateProjectAnswer - replace
$old2Start = '  private async generateProjectAnswer(input: {'
$old2End = '    return this.buildFallbackProjectAnswer(input);'
$new2 = @'
  private async generateProjectAnswer(input: {
    question: string;
    project: ProjectContext;
    recentMessages: Array<{ role: string; content: string }>;
    retrievedChunks: RetrievedContext[];
  }): Promise<GeneratedAnswer> {
    if (!this.groqGateway.hasKeys()) {
      return this.buildFallbackProjectAnswer(input);
    }

    const modelCandidates = this.buildAnswerModelCandidates();
    const primaryModel = modelCandidates[0];
    const fallbackModels = modelCandidates.slice(1);

    const result = await this.groqGateway.chatCompletion({
      model: primaryModel,
      fallbackModels,
      messages: this.buildProjectAnswerMessages(input),
      maxTokens: 900,
    });

    if (!result) {
      return this.buildFallbackProjectAnswer(input);
    }

    return {
      content: result.content,
      modelUsed: result.modelUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }
'@

$lines = $content -split "`r`n"

# Find generateAnswer bounds
$gaStart = -1; $gaEnd = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].TrimEnd() -eq $old1Start) { $gaStart = $i }
    if ($gaStart -ge 0 -and $lines[$i].TrimEnd() -eq $old1End) { $gaEnd = $i; break }
}
Write-Host "generateAnswer: start=$gaStart end=$gaEnd"

# Find generateProjectAnswer bounds  
$gpaStart = -1; $gpaEnd = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].TrimEnd() -eq $old2Start) { $gpaStart = $i }
    if ($gpaStart -ge 0 -and $lines[$i].TrimEnd() -eq $old2End) { $gpaEnd = $i; break }
}
Write-Host "generateProjectAnswer: start=$gpaStart end=$gpaEnd"

# Rebuild: take lines before gaStart, insert new1, take lines after gaEnd up to gpaStart, insert new2, take rest
$result = @()
$result += $lines[0..($gaStart - 1)]
$result += $new1 -split "`n"
$result += $lines[($gaEnd + 1)..($gpaStart - 1)]
$result += $new2 -split "`n"
$result += $lines[($gpaEnd + 1)..($lines.Count - 1)]

$final = ($result -join "`r`n").TrimEnd()
Set-Content -Path $file -Value $final -Encoding UTF8 -NoNewline
Write-Host "Done"
