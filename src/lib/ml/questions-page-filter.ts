export interface CurrentPageQuestion {
  id: number;
  itemId: string;
  anuncio: string;
  cliente: string;
  pergunta: string;
  resposta: string | null;
  dataPergunta: string;
  dataResposta: string | null;
}

export interface QuestionPageFilters {
  search: string;
  questionDateRange: readonly [Date | null, Date | null];
  answerDateRange: readonly [Date | null, Date | null];
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function filterQuestionsOnCurrentPage<T extends CurrentPageQuestion>(
  questions: readonly T[],
  filters: QuestionPageFilters,
): T[] {
  const search = filters.search.trim().toLowerCase();
  const [questionStart, questionEnd] = filters.questionDateRange;
  const [answerStart, answerEnd] = filters.answerDateRange;
  const questionEndOfDay = questionEnd ? endOfDay(questionEnd) : null;
  const answerEndOfDay = answerEnd ? endOfDay(answerEnd) : null;

  return questions.filter((question) => {
    if (search) {
      const fields = [
        String(question.id),
        question.itemId,
        question.anuncio,
        question.cliente,
        question.pergunta,
        question.resposta || '',
      ];
      if (!fields.some((field) => field.toLowerCase().includes(search))) {
        return false;
      }
    }

    const questionDate = new Date(question.dataPergunta);
    if (questionStart && questionDate < questionStart) return false;
    if (questionEndOfDay && questionDate > questionEndOfDay) return false;

    if (question.dataResposta) {
      const answerDate = new Date(question.dataResposta);
      if (answerStart && answerDate < answerStart) return false;
      if (answerEndOfDay && answerDate > answerEndOfDay) return false;
    } else if (answerStart || answerEnd) {
      return false;
    }

    return true;
  });
}
