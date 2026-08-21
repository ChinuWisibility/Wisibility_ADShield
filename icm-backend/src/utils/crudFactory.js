import { AppError } from "../middleware/errorHandler.js";

/** Only plain scalars are valid equality-filter values. Rejects objects/arrays
 * outright — that's how Mongo operators (`{"$ne":null}`) get smuggled in via
 * qs bracket-notation query strings like `?field[$ne]=x`. */
function isPlainScalar(val) {
  return (
    typeof val === "string" ||
    typeof val === "number" ||
    typeof val === "boolean"
  );
}

/** Escapes regex metacharacters so free-text search can't be used to build a
 * pathological/attacker-chosen regex (ReDoS) or match unintended patterns. */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createCrudController(Model, options = {}) {
  const {
    populate = [],
    searchFields = [],
    defaultSort = { createdAt: -1 },
  } = options;
  const modelHasTenant = !!Model.schema?.paths?.tenantId;

  const isPlatformPlaneActor = (actor) =>
    actor?.role === "superAdmin" ||
    (actor?.role === "admin" && !actor?.tenantId);

  const enforceTenantQueryScope = (query, actor) => {
    if (!modelHasTenant || !actor) return;
    if (isPlatformPlaneActor(actor)) return;
    if (!actor.tenantId)
      throw new AppError(
        "Tenant context required",
        403,
        "TENANT_SCOPE_REQUIRED",
      );
    query.tenantId = actor.tenantId;
  };

  const resolveCreateTenantId = (data, actor) => {
    if (!modelHasTenant || !actor) return;
    if (!isPlatformPlaneActor(actor)) {
      data.tenantId = actor.tenantId;
    } else if (!Object.prototype.hasOwnProperty.call(data, "tenantId")) {
      data.tenantId = null;
    }
  };

  return {
    async list(req, res, next) {
      try {
        const {
          page = 1,
          limit = 20,
          search,
          sort,
          order,
          ...filters
        } = req.query;
        const query = {};

        enforceTenantQueryScope(query, req.user);

        // Text search
        if (search && typeof search === "string" && searchFields.length) {
          query.$or = searchFields.map((f) => ({
            [f]: new RegExp(escapeRegExp(search), "i"),
          }));
        }

        // Apply filters — only plain scalar values reach the query; objects/
        // arrays (how Mongo operators get smuggled via ?field[$ne]=x) are
        // silently ignored rather than passed through to Model.find().
        for (const [key, val] of Object.entries(filters)) {
          if (
            key === "tenantId" &&
            modelHasTenant &&
            req.user &&
            !isPlatformPlaneActor(req.user)
          ) {
            continue;
          }
          if (val !== undefined && val !== "" && isPlainScalar(val) && Model.schema.paths[key]) {
            query[key] = val;
          }
        }

        const sortObj = sort
          ? { [sort]: order === "desc" ? -1 : 1 }
          : defaultSort;
        const skip = (Number(page) - 1) * Number(limit);

        const [items, total] = await Promise.all([
          Model.find(query)
            .sort(sortObj)
            .skip(skip)
            .limit(Number(limit))
            .populate(populate),
          Model.countDocuments(query),
        ]);

        res.json({
          success: true,
          data: {
            items,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
          },
        });
      } catch (err) {
        next(err);
      }
    },

    async getById(req, res, next) {
      try {
        const query = { _id: req.params.id };
        enforceTenantQueryScope(query, req.user);
        const item = await Model.findOne(query).populate(populate);
        if (!item) throw new AppError(`${Model.modelName} not found`, 404);
        res.json({ success: true, data: item });
      } catch (err) {
        next(err);
      }
    },

    async create(req, res, next) {
      try {
        const data = { ...req.body };
        if (req.user) data.createdBy = req.user.id;
        resolveCreateTenantId(data, req.user);
        const item = await Model.create(data);
        res.status(201).json({ success: true, data: item });
      } catch (err) {
        next(err);
      }
    },

    async update(req, res, next) {
      try {
        const data = { ...req.body };
        if (req.user) data.updatedBy = req.user.id;

        const query = { _id: req.params.id };
        enforceTenantQueryScope(query, req.user);

        if (modelHasTenant && req.user && !isPlatformPlaneActor(req.user)) {
          delete data.tenantId;
        }

        const item = await Model.findOneAndUpdate(query, data, {
          new: true,
          runValidators: true,
        });
        if (!item) throw new AppError(`${Model.modelName} not found`, 404);
        res.json({ success: true, data: item });
      } catch (err) {
        next(err);
      }
    },

    async remove(req, res, next) {
      try {
        const query = { _id: req.params.id };
        enforceTenantQueryScope(query, req.user);
        const item = await Model.findOneAndDelete(query);
        if (!item) throw new AppError(`${Model.modelName} not found`, 404);
        res.json({
          success: true,
          data: { message: `${Model.modelName} deleted` },
        });
      } catch (err) {
        next(err);
      }
    },

    async stats(req, res, next) {
      try {
        const query = {};
        enforceTenantQueryScope(query, req.user);
        const total = await Model.countDocuments(query);
        res.json({ success: true, data: { total } });
      } catch (err) {
        next(err);
      }
    },
  };
}
