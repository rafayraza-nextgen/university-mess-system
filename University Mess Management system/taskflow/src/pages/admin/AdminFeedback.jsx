import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareText, Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { formatDateKey } from "@/lib/date";
import { cn } from "@/lib/utils";

// Reviews live in meal_feedback, not on attendance. attendance is the record of
// who ate what and its status check only admits consumed / opted-out / absent,
// so it cannot carry a rating. See supabase/migrations/20261001_meal_feedback.sql.
//
// `users(full_name)` not `users(name)`: the column is full_name, and a wrong
// name fails the whole request with a 400 rather than degrading quietly.
const fetchFeedback = async () => {
  const { data, error } = await supabase
    .from("meal_feedback")
    .select(
      "id, rating, comment, created_at, menu_id, users ( full_name, student_id ), menus ( id, date, meal_type, main_dish )",
    )
    // Ordered through the embedded resource: menus(date) is a column of the
    // embedded table, so a bare date would be resolved against meal_feedback,
    // which has none.
    .order("menus(date)", { ascending: false });

  if (error) {
    return { data: [], error };
  }

  const readEmbedded = (row, relation) => {
    const value = row?.[relation];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };

  return {
    data: (data ?? [])
      .map((row) => {
        const menu = readEmbedded(row, "menus");
        const student = readEmbedded(row, "users");

        return {
          id: row.id,
          rating: Number(row.rating) || 0,
          comment: row.comment,
          studentName: student?.full_name ?? "Unknown student",
          studentId: student?.student_id ?? null,
          date: menu?.date ?? null,
          mealType: menu?.meal_type ?? "Meal",
          dish: menu?.main_dish ?? "Unknown dish",
        };
      })
      // A review whose menu was unlinked cannot be grouped under a meal, so it is
      // dropped rather than filed under a placeholder that would misreport the
      // average.
      .filter((entry) => entry.date),
    error: null,
  };
};

// Grouped by menu so one card answers "how did this meal do" and lists the
// individual comments underneath.
const groupByMeal = (entries) => {
  const groups = new Map();

  entries.forEach((entry) => {
    const existing = groups.get(entry.menu_id ?? entry.date) ?? {
      key: entry.menu_id ?? entry.date,
      date: entry.date,
      mealType: entry.mealType,
      dish: entry.dish,
      reviews: [],
      ratingSum: 0,
    };

    existing.reviews.push(entry);
    existing.ratingSum += entry.rating;
    groups.set(existing.key, existing);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      count: group.reviews.length,
      average: group.ratingSum / group.reviews.length,
      // Worst-rated first within a meal: the complaints are the reason an admin
      // opens this screen.
      reviews: [...group.reviews].sort((first, second) => first.rating - second.rating),
    }))
    .sort((first, second) => second.date.localeCompare(first.date));
};

const averageTone = (average) => {
  if (average >= 4) return { text: "text-emerald-600", bar: "bg-emerald-500" };
  if (average >= 3) return { text: "text-amber-600", bar: "bg-amber-500" };
  return { text: "text-red-600", bar: "bg-red-500" };
};

export function AdminFeedback() {
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Loading starts true, so the first state update lands after the await and the
  // effect body itself never sets state.
  useEffect(() => {
    let active = true;

    const loadFeedback = async () => {
      const { data, error } = await fetchFeedback();

      if (!active) return;

      if (error) {
        console.warn("Unable to load meal feedback.", error);
        setLoadError(
          "Database Error: " + (error.message || error.code || "Unknown error"),
        );
        setEntries([]);
      } else {
        setLoadError("");
        setEntries(data);
      }

      setIsLoading(false);
    };

    loadFeedback();

    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => groupByMeal(entries), [entries]);

  const overallAverage = useMemo(() => {
    if (!entries.length) return null;
    return entries.reduce((sum, entry) => sum + entry.rating, 0) / entries.length;
  }, [entries]);

  return (
    <Card className="w-full border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-200">
        <CardTitle>Student Reviews</CardTitle>
        <CardDescription>
          {isLoading
            ? "Loading student feedback..."
            : loadError
              ? loadError
              : entries.length
                ? `${entries.length} review${entries.length === 1 ? "" : "s"} across ${groups.length} meal${groups.length === 1 ? "" : "s"}, averaging ${overallAverage.toFixed(1)} of 5.`
                : "No reviews have been submitted yet."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 p-0">
        {loadError && !isLoading && (
          <div
            role="alert"
            className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            {loadError}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading reviews...
          </div>
        )}

        {!isLoading && !loadError && !groups.length && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <MessageSquareText className="size-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-600">No reviews yet</p>
            <p className="max-w-sm text-xs text-slate-500">
              Students can rate a meal from Recent Meals on their dashboard. Reviews
              appear here once submitted.
            </p>
          </div>
        )}

        {groups.map((group) => {
          const tone = averageTone(group.average);

          return (
            <div key={group.key} className="border-b border-slate-100 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {group.mealType} - {group.dish}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateKey(group.date, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {" · "}
                    {group.count} review{group.count === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="text-right">
                  <p className={cn("text-lg font-extrabold", tone.text)}>
                    {group.average.toFixed(1)}
                    <span className="text-xs font-medium text-slate-400">/5</span>
                  </p>
                  <div className="mt-1 flex items-center justify-end gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={cn(
                          "size-3.5",
                          star <= Math.round(group.average)
                            ? "fill-amber-400 text-amber-400"
                            : "text-slate-300",
                        )}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </div>
              </div>

              <ul className="divide-y divide-slate-100">
                {group.reviews.map((entry) => (
                  <li key={entry.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {entry.studentName}
                      </span>
                      {entry.studentId && (
                        <span className="text-xs text-slate-500">{entry.studentId}</span>
                      )}
                      <span
                        className={cn(
                          "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                          entry.rating >= 4
                            ? "bg-emerald-50 text-emerald-700"
                            : entry.rating >= 3
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700",
                        )}
                      >
                        {entry.rating}/5
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{entry.comment}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
