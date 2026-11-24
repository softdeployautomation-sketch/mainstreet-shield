export class CompanyNotFoundError extends Error {
  constructor() {
    super("company_not_found");
    this.name = "CompanyNotFoundError";
  }
}

export const companyNotFound = new CompanyNotFoundError();