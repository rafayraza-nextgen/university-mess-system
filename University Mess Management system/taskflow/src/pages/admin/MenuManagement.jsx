import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateKey, getLocalDateKey, shiftDateKey } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const MEAL_TYPES = ["Breakfast", "Lunch", "Snack", "Dinner"];

// Service windows. Both the staff scanner and the student opt-out cutoff read
// menus.start_time / menus.end_time, so a meal saved without them can never be
// served or opted out of. Picking a meal type fills these in as a starting point.
const MEAL_WINDOWS = {
  Breakfast: { startTime: "08:00", endTime: "09:00" },
  Lunch: { startTime: "13:00", endTime: "14:00" },
  Snack: { startTime: "16:00", endTime: "17:00" },
  Dinner: { startTime: "19:00", endTime: "20:00" },
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatPrice = (value) =>
  value === null || value === undefined ? "—" : currencyFormatter.format(Number(value));

// A blank price is stored as null ("not priced") rather than 0, which would read
// as a free meal.
const parsePrice = (raw) => {
  const trimmed = String(raw ?? "").trim();

  if (trimmed === "") {
    return { value: null };
  }

  const parsed = Number(trimmed);

  if (Number.isNaN(parsed) || parsed < 0) {
    return { error: "Enter a valid price, or leave it blank." };
  }

  return { value: parsed };
};

const fetchMenus = async () => {
  const { data, error } = await supabase
    .from("menus")
    .select("id, date, meal_type, main_dish, price, status, start_time, end_time")
    .order("date", { ascending: true });

  return { data: data ?? [], error };
};

const getDefaultDate = () => shiftDateKey(getLocalDateKey(), 1);

// Matches the MEAL_RATE used for the student bill estimate. New meals start
// priced; existing unpriced meals still open blank in the edit dialog so no
// price is assumed on their behalf.
const DEFAULT_PRICE = "5.00";

const createEmptyForm = () => ({
  date: getDefaultDate(),
  mealType: "Breakfast",
  mainDish: "",
  price: DEFAULT_PRICE,
  startTime: MEAL_WINDOWS.Breakfast.startTime,
  endTime: MEAL_WINDOWS.Breakfast.endTime,
});

// Postgres `time` accepts HH:MM, so a native time input value is stored as-is.
// A blank is written as null so the meal reads as unscheduled rather than
// silently defaulting to midnight.
const toTimeValue = (raw) => {
  const trimmed = String(raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

// Shared by the add and edit dialogs so the service window is entered the same
// way in both. Without it a meal can never be served or opted out of.
function ServiceWindowFields({ idPrefix, form, onChange, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-start-time`}>Service Starts</Label>
        <Input
          id={`${idPrefix}-start-time`}
          type="time"
          step="60"
          className="w-full"
          disabled={disabled}
          value={form.startTime}
          onChange={(event) => onChange({ startTime: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-end-time`}>Service Ends</Label>
        <Input
          id={`${idPrefix}-end-time`}
          type="time"
          step="60"
          className="w-full"
          disabled={disabled}
          value={form.endTime}
          onChange={(event) => onChange({ endTime: event.target.value })}
        />
      </div>
      <p className="col-span-2 text-xs text-slate-500">
        Students cannot opt out once service has started, and the counter only
        accepts scans between these two times.
      </p>
    </div>
  );
}

export function MenuManagement() {
  const [menus, setMenus] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [form, setForm] = useState(createEmptyForm);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [editingMenu, setEditingMenu] = useState(null);
  const [editForm, setEditForm] = useState(createEmptyForm);
  const [menuPendingDelete, setMenuPendingDelete] = useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data, error } = await fetchMenus();

      if (!active) return;

      if (error) {
        console.warn("Unable to load the menu.", error);
        setLoadError("We could not load the menu. Please refresh to try again.");
      } else {
        setLoadError("");
        setMenus(data);
      }

      setIsLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  // Selecting the affected row back is required: PostgREST reports success for
  // a write that RLS filtered out, so an empty result means it never landed.
  const handleAddMenu = async (event) => {
    event.preventDefault();
    setActionError("");

    const mainDish = form.mainDish.trim();
    const { value: price, error: priceError } = parsePrice(form.price);

    if (!mainDish) {
      setActionError("Enter a main dish for the meal.");
      return;
    }

    if (priceError) {
      setActionError(priceError);
      return;
    }

    setIsSaving(true);

    try {
      const { data: created, error } = await supabase
        .from("menus")
        .insert({
          date: form.date,
          meal_type: form.mealType,
          main_dish: mainDish,
          price,
          start_time: toTimeValue(form.startTime),
          end_time: toTimeValue(form.endTime),
          // Must match the check constraint: 'Published' or 'Draft'.
          status: "Published",
        })
        .select("id, date, meal_type, main_dish, price, status")
        .single();

      if (error) {
        // menus_date_meal_type_key unique (date, meal_type)
        if (error.code === "23505") {
          setActionError(
            `A ${form.mealType} meal is already scheduled for ${form.date}. Edit it instead.`,
          );
          return;
        }

        console.warn("Unable to create the menu item.", error);
        setActionError("We could not save that meal. Please try again.");
        return;
      }

      if (!created) {
        setActionError("The meal could not be saved. Check your permissions.");
        return;
      }

      setMenus((current) =>
        [...current, created].sort((first, second) => first.date.localeCompare(second.date)),
      );
      setForm(createEmptyForm());
      setShowAddMenu(false);
    } finally {
      setIsSaving(false);
    }
  };

  const openEditDialog = (menu) => {
    setEditingMenu(menu);
    setEditForm({
      date: menu.date,
      mealType: menu.meal_type,
      mainDish: menu.main_dish,
      price: menu.price === null || menu.price === undefined ? "" : String(menu.price),
      // Postgres returns `time` as HH:MM:SS; a native time input wants HH:MM.
      startTime: String(menu.start_time ?? "").slice(0, 5),
      endTime: String(menu.end_time ?? "").slice(0, 5),
    });
    setActionError("");
    setShowEditMenu(true);
  };

  const closeEditDialog = () => {
    setShowEditMenu(false);
    setEditingMenu(null);
    setEditForm(createEmptyForm());
  };

  const handleEditDialogChange = (open) => {
    if (!open) {
      closeEditDialog();
    }
  };

  const handleUpdateMenu = async (event) => {
    event.preventDefault();
    setActionError("");

    if (!editingMenu) return;

    const mainDish = editForm.mainDish.trim();
    const { value: price, error: priceError } = parsePrice(editForm.price);

    if (!mainDish) {
      setActionError("Enter a main dish for the meal.");
      return;
    }

    if (priceError) {
      setActionError(priceError);
      return;
    }

    setIsSaving(true);

    try {
      const { data: updated, error } = await supabase
        .from("menus")
        .update({
          date: editForm.date,
          meal_type: editForm.mealType,
          main_dish: mainDish,
          price,
          start_time: toTimeValue(editForm.startTime),
          end_time: toTimeValue(editForm.endTime),
        })
        .eq("id", editingMenu.id)
        .select("id, date, meal_type, main_dish, price, status, start_time, end_time")
        .maybeSingle();

      if (error) {
        if (error.code === "23505") {
          setActionError(
            `A ${editForm.mealType} meal is already scheduled for ${editForm.date}.`,
          );
          return;
        }

        console.warn("Unable to update the menu item.", error);
        setActionError("We could not save those changes. Please try again.");
        return;
      }

      if (!updated) {
        setActionError("Those changes could not be saved. Check your permissions.");
        return;
      }

      setMenus((current) =>
        current
          .map((menu) => (menu.id === updated.id ? updated : menu))
          .sort((first, second) => first.date.localeCompare(second.date)),
      );
      closeEditDialog();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteMenu = async () => {
    if (!menuPendingDelete) return;

    const menu = menuPendingDelete;
    setMenuPendingDelete(null);
    setActionError("");
    setIsSaving(true);

    try {
      const { data: deleted, error } = await supabase
        .from("menus")
        .delete()
        .eq("id", menu.id)
        .select("id");

      if (error) {
        console.warn("Unable to delete the menu item.", error);
        setActionError("We could not delete that meal. Please try again.");
        return;
      }

      if (!deleted || deleted.length === 0) {
        setActionError("That meal could not be deleted. Check your permissions.");
        return;
      }

      setMenus((current) => current.filter((item) => item.id !== menu.id));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Card className="w-full border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Menu Management</CardTitle>
            <CardDescription>
              Review, edit, and remove meals for upcoming service dates.
            </CardDescription>
          </div>
          <Button
            type="button"
            onClick={() => {
              setActionError("");
              setForm(createEmptyForm());
              setShowAddMenu(true);
            }}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="size-4" />
            Add New Menu
          </Button>
        </CardHeader>

        <CardContent className="space-y-4 p-0">
          {loadError && (
            <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadError}
            </div>
          )}

          {actionError && (
            <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {actionError}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Meal Type</TableHead>
                <TableHead>Main Dish</TableHead>
                <TableHead>Service Window</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {menus.map((menu) => (
                <TableRow key={menu.id}>
                  <TableCell className="font-medium text-slate-700">
                    {formatDateKey(menu.date, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>{menu.meal_type}</TableCell>
                  <TableCell className="font-medium text-slate-900">{menu.main_dish}</TableCell>
                  <TableCell>
                    {menu.start_time && menu.end_time ? (
                      <span className="font-mono text-xs text-slate-600">
                        {String(menu.start_time).slice(0, 5)} –{" "}
                        {String(menu.end_time).slice(0, 5)}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-amber-700">
                        Not scheduled
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-slate-900">
                    {formatPrice(menu.price)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                        menu.status === "Published"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700",
                      )}
                    >
                      {menu.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => openEditDialog(menu)}
                        aria-label={`Edit ${menu.meal_type} menu`}
                        title="Edit menu"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => setMenuPendingDelete(menu)}
                        aria-label={`Delete ${menu.meal_type} menu`}
                        title="Delete menu"
                        className="text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-sm text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Loading the menu...
                    </span>
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !menus.length && (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-sm text-slate-500">
                    No upcoming menus have been added.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={showAddMenu}
        onOpenChange={(open) => {
          setShowAddMenu(open);
          if (!open) setActionError("");
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleAddMenu}>
            <DialogHeader>
              <DialogTitle>Add New Menu</DialogTitle>
              <DialogDescription>Create and publish an upcoming meal for students.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {actionError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  className="w-full"
                  required
                  disabled={isSaving}
                  value={form.date}
                  onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="meal-type">Meal Type</Label>
                <Select
                  value={form.mealType}
                  onValueChange={(mealType) =>
                    setForm((current) => ({
                      ...current,
                      mealType,
                      // Offer the default window for the chosen slot; both
                      // fields stay editable afterwards.
                      ...MEAL_WINDOWS[mealType],
                    }))
                  }
                  disabled={isSaving}
                >
                  <SelectTrigger id="meal-type" className="w-full">
                    <SelectValue placeholder="Select meal type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEAL_TYPES.map((mealType) => (
                      <SelectItem key={mealType} value={mealType}>
                        {mealType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ServiceWindowFields
                idPrefix="add"
                form={form}
                disabled={isSaving}
                onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              />

              <div className="grid gap-2">
                <Label htmlFor="main-dish">Main Dish</Label>
                <Input
                  id="main-dish"
                  className="w-full"
                  required
                  disabled={isSaving}
                  value={form.mainDish}
                  onChange={(event) => setForm((current) => ({ ...current, mainDish: event.target.value }))}
                  placeholder="Enter the main dish"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="price">Price</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="w-full"
                  disabled={isSaving}
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  placeholder="Leave blank if not priced"
                />
              </div>
            </div>

            <DialogFooter className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowAddMenu(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {isSaving ? "Saving..." : "Add Menu"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditMenu} onOpenChange={handleEditDialogChange}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleUpdateMenu}>
            <DialogHeader>
              <DialogTitle>Edit Menu</DialogTitle>
              <DialogDescription>
                {editingMenu
                  ? `Update ${editingMenu.meal_type} for ${editingMenu.main_dish}.`
                  : "Update this upcoming meal."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {actionError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="edit-date">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  className="w-full"
                  required
                  disabled={isSaving}
                  value={editForm.date}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, date: event.target.value }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-meal-type">Meal Type</Label>
                <Select
                  value={editForm.mealType}
                  onValueChange={(mealType) =>
                    setEditForm((current) => ({
                      ...current,
                      mealType,
                      ...MEAL_WINDOWS[mealType],
                    }))
                  }
                  disabled={isSaving}
                >
                  <SelectTrigger id="edit-meal-type" className="w-full">
                    <SelectValue placeholder="Select meal type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEAL_TYPES.map((mealType) => (
                      <SelectItem key={mealType} value={mealType}>
                        {mealType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ServiceWindowFields
                idPrefix="edit"
                form={editForm}
                disabled={isSaving}
                onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
              />

              <div className="grid gap-2">
                <Label htmlFor="edit-main-dish">Main Dish</Label>
                <Input
                  id="edit-main-dish"
                  className="w-full"
                  required
                  disabled={isSaving}
                  value={editForm.mainDish}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      mainDish: event.target.value,
                    }))
                  }
                  placeholder="Enter the main dish"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-price">Price</Label>
                <Input
                  id="edit-price"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="w-full"
                  disabled={isSaving}
                  value={editForm.price}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, price: event.target.value }))
                  }
                  placeholder="Leave blank if not priced"
                />
              </div>
            </div>

            <DialogFooter className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={closeEditDialog} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(menuPendingDelete)}
        onOpenChange={(open) => {
          if (!open) setMenuPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete this meal?</DialogTitle>
            <DialogDescription>
              {menuPendingDelete
                ? `${menuPendingDelete.meal_type} on ${formatDateKey(menuPendingDelete.date, { month: "short", day: "numeric", year: "numeric" })} will be removed from the menu.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Attendance records for this meal are linked with{" "}
            <code className="font-mono text-xs">on delete cascade</code>, so every
            student already marked as consumed or opted out for it will lose that
            record. This cannot be undone.
          </div>

          <DialogFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setMenuPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDeleteMenu}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete meal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
