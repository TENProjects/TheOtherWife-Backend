/** @format */

import mongoose from "mongoose";
import SiteContent from "../models/siteContent.model.js";

export class SiteContentService {
  private getOrCreateSiteContent = async () => {
    let content = await SiteContent.findOne();
    if (!content) {
      content = await SiteContent.create({});
    }
    return content;
  };

  getContent = async () => {
    const content = await this.getOrCreateSiteContent();
    return {
      aboutUs: content.aboutUs,
      contactEmail: content.contactEmail,
      contactPhone: content.contactPhone,
    };
  };

  updateContent = async (
    payload: { aboutUs?: string; contactEmail?: string; contactPhone?: string },
    adminUserId: string,
  ) => {
    const content = await this.getOrCreateSiteContent();

    if (payload.aboutUs !== undefined) content.aboutUs = payload.aboutUs;
    if (payload.contactEmail !== undefined)
      content.contactEmail = payload.contactEmail;
    if (payload.contactPhone !== undefined)
      content.contactPhone = payload.contactPhone;

    content.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await content.save();

    return {
      aboutUs: content.aboutUs,
      contactEmail: content.contactEmail,
      contactPhone: content.contactPhone,
    };
  };
}
